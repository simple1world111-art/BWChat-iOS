import { DatePicker, Host, Picker, Text as SwiftUIText } from "@expo/ui/swift-ui";
import {
  accessibilityLabel as swiftUIAccessibilityLabel,
  datePickerStyle,
  environment,
  labelsHidden,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import * as ImagePicker from "expo-image-picker";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

import { getProfile, updateProfile, uploadAvatar } from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { Avatar } from "@/components/Avatar";
import type { User } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { clearImageCache } from "@/services/cache/ImageCacheService";
import {
  birthdayForProfileSave,
  canSaveProfileNickname,
  defaultProfileBirthdayDate,
  displayProfileBirthday,
  editProfilePolicy,
  formatProfileBirthday,
  isProfileGender,
  limitProfileBio,
  makeProfileEditValues,
  parseProfileBirthday,
  profileBioLength,
  profileUsersEqual,
  type ProfileEditValues,
} from "@/services/profile/editProfilePolicy";
import { colors, palette } from "@/theme";

const emptyProfileValues: ProfileEditValues = {
  nickname: "",
  bio: "",
  gender: "",
  birthday: "",
  location: "",
};

export default function EditProfileScreen() {
  const { user, updateUser } = useAuth();
  const ownerKey = trimFoundationWhitespacesAndNewlines(user?.user_id ?? "") || "guest";
  return <EditProfileContent key={ownerKey} updateUser={updateUser} user={user} />;
}

function EditProfileContent({
  user,
  updateUser,
}: {
  user: User | null;
  updateUser: (user: User) => Promise<void>;
}) {
  const { activeLanguage, t } = useLocalization();
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const [profile, setProfile] = useState<User | null>(user);
  const [values, setValues] = useState<ProfileEditValues>(() =>
    user ? makeProfileEditValues(user) : emptyProfileValues,
  );
  const [birthdayDate, setBirthdayDate] = useState(
    () => parseProfileBirthday(user?.birthday ?? "") ?? defaultProfileBirthdayDate(),
  );
  const [showsBirthdayPicker, setShowsBirthdayPicker] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastOpacity] = useState(() => new Animated.Value(0));
  const [toastTranslation] = useState(() => new Animated.Value(18));
  const toastTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const toastVisibleRef = useRef(false);
  const operationActiveRef = useRef(true);

  useEffect(
    () => () => {
      operationActiveRef.current = false;
      for (const timer of toastTimersRef.current) clearTimeout(timer);
      toastTimersRef.current.clear();
    },
    [],
  );

  const showErrorToast = useCallback(
    (message: string) => {
      setToastMessage(message);
      if (!toastVisibleRef.current) {
        toastVisibleRef.current = true;
        toastOpacity.stopAnimation();
        toastTranslation.stopAnimation();
        toastOpacity.setValue(0);
        toastTranslation.setValue(18);
        Animated.parallel([
          Animated.timing(toastOpacity, {
            toValue: 1,
            duration: editProfilePolicy.toastAnimationMs,
            useNativeDriver: true,
          }),
          Animated.timing(toastTranslation, {
            toValue: 0,
            duration: editProfilePolicy.toastAnimationMs,
            useNativeDriver: true,
          }),
        ]).start();
      }
      const timer = setTimeout(() => {
        toastTimersRef.current.delete(timer);
        if (!toastVisibleRef.current) return;
        toastVisibleRef.current = false;
        Animated.parallel([
          Animated.timing(toastOpacity, {
            toValue: 0,
            duration: editProfilePolicy.toastAnimationMs,
            useNativeDriver: true,
          }),
          Animated.timing(toastTranslation, {
            toValue: 18,
            duration: editProfilePolicy.toastAnimationMs,
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished && !toastVisibleRef.current) setToastMessage(null);
        });
      }, editProfilePolicy.toastDurationMs);
      toastTimersRef.current.add(timer);
    },
    [toastOpacity, toastTranslation],
  );

  const canSave = canSaveProfileNickname(values.nickname) && !isSaving;

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    let shouldPop = false;
    try {
      const updated = await updateProfile({
        nickname: values.nickname,
        bio: limitProfileBio(values.bio),
        gender: values.gender,
        birthday: birthdayForProfileSave(values.birthday, birthdayDate),
        location: values.location,
      });
      if (!operationActiveRef.current) return;
      await updateUser(updated);
      if (!operationActiveRef.current) return;
      shouldPop = true;
    } catch (error) {
      if (!operationActiveRef.current) return;
      showErrorToast(errorMessage(error, t("common.operationFailed")));
    } finally {
      if (operationActiveRef.current) setSaving(false);
    }
    if (shouldPop && operationActiveRef.current) router.back();
  }, [birthdayDate, canSave, showErrorToast, t, updateUser, values]);

  const pickAvatar = useCallback(async () => {
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
        selectionLimit: 1,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      });
    } catch {
      // Swift PhotosPicker uses `try?` for reading the selected asset.
      return;
    }
    if (result.canceled || !result.assets[0]) return;
    let uploadSucceeded = false;
    try {
      setSaving(true);
      await uploadAvatar(result.assets[0].uri);
      uploadSucceeded = true;
      if (!operationActiveRef.current) return;
      let updated: User | null = null;
      try {
        updated = await getProfile();
      } catch (error) {
        // Native loadProfile only surfaces a refresh error when no cached profile exists.
        if (operationActiveRef.current && profile === null) {
          showErrorToast(errorMessage(error, t("common.operationFailed")));
        }
      }
      if (!operationActiveRef.current) return;
      if (updated && !profileUsersEqual(profile, updated)) {
        setProfile(updated);
        setValues(makeProfileEditValues(updated));
        setBirthdayDate(parseProfileBirthday(updated.birthday) ?? defaultProfileBirthdayDate());
        await updateUser(updated);
      }
    } catch (error) {
      if (!operationActiveRef.current) return;
      showErrorToast(errorMessage(error, t("common.operationFailed")));
    } finally {
      if (uploadSucceeded) await clearImageCache().catch(() => undefined);
      if (operationActiveRef.current) setSaving(false);
    }
  }, [profile, showErrorToast, t, updateUser]);

  const setField = useCallback(
    <K extends keyof ProfileEditValues>(key: K, value: ProfileEditValues[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const toggleBirthdayPicker = useCallback(() => {
    Keyboard.dismiss();
    LayoutAnimation.configureNext({
      duration: editProfilePolicy.birthdayOpenAnimationMs,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
    setShowsBirthdayPicker((current) => !current);
  }, []);

  const closeBirthdayPicker = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: editProfilePolicy.birthdayCloseAnimationMs,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
    setShowsBirthdayPicker(false);
  }, []);

  const displayBirthday = useMemo(() => {
    return displayProfileBirthday(values.birthday, activeLanguage, t("profile.unset"));
  }, [activeLanguage, t, values.birthday]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: t("profile.edit.title"),
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              accessibilityLabel={t("common.back")}
              accessibilityRole="button"
              hitSlop={4}
              onPress={router.back}
              style={styles.backButton}
            >
              <SymbolView name="chevron.left" size={17} weight="semibold" tintColor={theme.text} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              disabled={!canSave}
              hitSlop={8}
              onPress={() => void save()}
              style={styles.headerSave}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>
                  {t("common.save")}
                </Text>
              )}
            </Pressable>
          ),
        }}
      />

      <Pressable onPress={Keyboard.dismiss} style={styles.dismissArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.avatarSection}>
            <Pressable
              accessibilityLabel={t("profile.avatar.change")}
              accessibilityRole="button"
              onPress={() => void pickAvatar()}
              style={styles.avatarButton}
            >
              <View style={styles.avatarShadow}>
                <Avatar
                  cornerRadius={editProfilePolicy.avatarSize * 0.22}
                  name={profile?.nickname ?? values.nickname}
                  size={editProfilePolicy.avatarSize}
                  uri={profile?.avatar_url}
                />
              </View>
              <View style={styles.cameraBadge}>
                <SymbolView
                  name="camera.fill"
                  size={editProfilePolicy.cameraSymbolSize}
                  weight="bold"
                  tintColor="#FFFFFF"
                />
              </View>
            </Pressable>
            <Text style={[styles.avatarHint, { color: theme.secondaryText }]}>
              {t("profile.avatar.change")}
            </Text>
          </View>

          <View style={[styles.formCard, { backgroundColor: theme.card }]}>
            <EditRow title={t("profile.nickname")} titleColor={theme.text}>
              <TextInput
                accessibilityLabel={t("profile.nickname")}
                onChangeText={(value) => setField("nickname", value)}
                placeholder={t("profile.nickname.placeholder")}
                placeholderTextColor={theme.tertiaryText}
                returnKeyType="next"
                style={[styles.trailingInput, { color: theme.text }]}
                value={values.nickname}
              />
            </EditRow>
            <Divider color={theme.separator} />

            <EditRow title={t("profile.bio")} titleColor={theme.text}>
              <View style={styles.bioColumn}>
                <TextInput
                  accessibilityLabel={t("profile.bio")}
                  multiline
                  onChangeText={(value) => setField("bio", limitProfileBio(value))}
                  placeholder={t("profile.bio.placeholder")}
                  placeholderTextColor={theme.tertiaryText}
                  scrollEnabled={false}
                  style={[styles.bioInput, { color: theme.text }]}
                  value={values.bio}
                />
                <Text
                  style={[
                    styles.bioCounter,
                    {
                      color:
                        profileBioLength(values.bio) === editProfilePolicy.bioCharacterLimit
                          ? colors.warning
                          : theme.tertiaryText,
                    },
                  ]}
                >
                  {profileBioLength(values.bio)}/{editProfilePolicy.bioCharacterLimit}
                </Text>
              </View>
            </EditRow>
            <Divider color={theme.separator} />

            <EditRow title={t("profile.gender")} titleColor={theme.text}>
              <Host
                colorScheme={scheme === "dark" ? "dark" : "light"}
                ignoreSafeArea="all"
                matchContents
                seedColor={colors.accent}
                style={styles.genderHost}
              >
                <Picker
                  label=""
                  modifiers={[pickerStyle("menu"), swiftUIAccessibilityLabel(t("profile.gender"))]}
                  onSelectionChange={(selection) => {
                    if (typeof selection === "string" && isProfileGender(selection)) {
                      setField("gender", selection);
                    }
                  }}
                  selection={values.gender}
                >
                  <SwiftUIText modifiers={[tag("")]}>{t("profile.unset")}</SwiftUIText>
                  <SwiftUIText modifiers={[tag("male")]}>{t("profile.gender.male")}</SwiftUIText>
                  <SwiftUIText modifiers={[tag("female")]}>
                    {t("profile.gender.female")}
                  </SwiftUIText>
                  <SwiftUIText modifiers={[tag("other")]}>{t("profile.gender.other")}</SwiftUIText>
                </Picker>
              </Host>
            </EditRow>
            <Divider color={theme.separator} />

            <Pressable
              accessibilityLabel={t("profile.birthday")}
              accessibilityRole="button"
              accessibilityState={{ expanded: showsBirthdayPicker }}
              onPress={toggleBirthdayPicker}
              style={styles.birthdayRow}
            >
              <Text
                adjustsFontSizeToFit
                minimumFontScale={editProfilePolicy.rowTitleMinimumScale}
                numberOfLines={1}
                style={[styles.rowTitle, { color: theme.text }]}
              >
                {t("profile.birthday")}
              </Text>
              <View style={styles.birthdayTrailing}>
                <Text
                  style={[
                    styles.birthdayValue,
                    { color: values.birthday ? theme.text : theme.tertiaryText },
                  ]}
                >
                  {displayBirthday}
                </Text>
                <SymbolView
                  name={showsBirthdayPicker ? "chevron.up" : "chevron.down"}
                  size={12}
                  weight="semibold"
                  tintColor={theme.tertiaryText}
                />
              </View>
            </Pressable>
            <Divider color={theme.separator} />

            <EditRow title={t("profile.location")} titleColor={theme.text}>
              <TextInput
                accessibilityLabel={t("profile.location")}
                onChangeText={(value) => setField("location", value)}
                placeholder={t("profile.location.placeholder")}
                placeholderTextColor={theme.tertiaryText}
                returnKeyType="done"
                style={[styles.trailingInput, { color: theme.text }]}
                value={values.location}
              />
            </EditRow>
          </View>

          {showsBirthdayPicker ? (
            <View style={[styles.birthdayCard, { backgroundColor: theme.card }]}>
              <Host
                colorScheme={scheme === "dark" ? "dark" : "light"}
                ignoreSafeArea="all"
                seedColor={colors.accent}
                style={styles.birthdayHost}
              >
                <DatePicker
                  displayedComponents={["date"]}
                  modifiers={[
                    datePickerStyle("wheel"),
                    labelsHidden(),
                    environment("locale", activeLanguage),
                  ]}
                  onDateChange={(date) => {
                    setBirthdayDate(date);
                    setField("birthday", formatProfileBirthday(date));
                  }}
                  range={{ end: new Date() }}
                  selection={birthdayDate}
                  title={t("profile.birthday.select")}
                />
              </Host>
              <View style={styles.birthdayActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setBirthdayDate(defaultProfileBirthdayDate());
                    setField("birthday", "");
                    closeBirthdayPicker();
                  }}
                >
                  <Text style={styles.clearBirthday}>{t("profile.birthday.clear")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setField("birthday", formatProfileBirthday(birthdayDate));
                    closeBirthdayPicker();
                  }}
                >
                  <Text style={styles.doneBirthday}>{t("common.done")}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </Pressable>

      {toastMessage ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            { opacity: toastOpacity, transform: [{ translateY: toastTranslation }] },
          ]}
        >
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

function EditRow({
  title,
  titleColor,
  children,
}: {
  title: string;
  titleColor: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.editRow}>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={editProfilePolicy.rowTitleMinimumScale}
        numberOfLines={1}
        style={[styles.rowTitle, { color: titleColor }]}
      >
        {title}
      </Text>
      <View style={styles.rowContent}>{children}</View>
    </View>
  );
}

function Divider({ color }: { color: string }) {
  return <View style={[styles.divider, { backgroundColor: color }]} />;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dismissArea: { flex: 1 },
  content: { rowGap: editProfilePolicy.sectionSpacing, paddingBottom: 30 },
  backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerSave: { minWidth: 42, minHeight: 36, alignItems: "flex-end", justifyContent: "center" },
  saveText: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  saveTextDisabled: { opacity: 0.35 },
  avatarSection: {
    alignItems: "center",
    paddingTop: editProfilePolicy.avatarTopPadding,
    rowGap: editProfilePolicy.avatarLabelSpacing,
  },
  avatarButton: { width: editProfilePolicy.avatarSize, height: editProfilePolicy.avatarSize },
  avatarShadow: {
    width: editProfilePolicy.avatarSize,
    height: editProfilePolicy.avatarSize,
    shadowColor: colors.accent,
    shadowOpacity: 0.2,
    shadowRadius: editProfilePolicy.avatarShadowRadius,
    shadowOffset: { width: 0, height: editProfilePolicy.avatarShadowY },
  },
  cameraBadge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: editProfilePolicy.cameraBadgeSize,
    height: editProfilePolicy.cameraBadgeSize,
    borderRadius: editProfilePolicy.cameraBadgeSize / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  avatarHint: { fontSize: 13 },
  formCard: {
    marginHorizontal: editProfilePolicy.formHorizontalPadding,
    paddingVertical: editProfilePolicy.formVerticalPadding,
    borderRadius: editProfilePolicy.formRadius,
    overflow: "hidden",
  },
  editRow: {
    minHeight: 54,
    paddingHorizontal: editProfilePolicy.rowHorizontalPadding,
    paddingVertical: editProfilePolicy.rowVerticalPadding,
    flexDirection: "row",
    alignItems: "center",
  },
  rowTitle: {
    width: editProfilePolicy.rowTitleWidth,
    fontSize: editProfilePolicy.titleSize,
    fontWeight: "500",
  },
  rowContent: { flex: 1, minWidth: 0, alignItems: "stretch" },
  trailingInput: {
    flex: 1,
    margin: 0,
    padding: 0,
    fontSize: editProfilePolicy.valueSize,
    textAlign: "right",
  },
  bioColumn: { flex: 1, alignItems: "stretch", rowGap: 5 },
  bioInput: {
    minHeight: 18,
    maxHeight: 60,
    margin: 0,
    padding: 0,
    fontSize: editProfilePolicy.valueSize,
    textAlign: "left",
  },
  bioCounter: {
    alignSelf: "flex-end",
    fontSize: editProfilePolicy.bioCounterSize,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  genderHost: { alignSelf: "flex-end" },
  birthdayRow: {
    minHeight: 54,
    paddingHorizontal: editProfilePolicy.rowHorizontalPadding,
    paddingVertical: editProfilePolicy.rowVerticalPadding,
    flexDirection: "row",
    alignItems: "center",
  },
  birthdayTrailing: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    columnGap: 8,
  },
  birthdayValue: { flexShrink: 1, fontSize: editProfilePolicy.valueSize, textAlign: "right" },
  birthdayCard: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 14,
    rowGap: 8,
    overflow: "hidden",
  },
  birthdayHost: { width: "100%", height: 216 },
  birthdayActions: {
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  clearBirthday: { color: colors.danger, fontSize: 14 },
  doneBirthday: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  toast: {
    position: "absolute",
    alignSelf: "center",
    bottom: editProfilePolicy.toastBottomPadding,
    maxWidth: "88%",
    paddingHorizontal: editProfilePolicy.toastHorizontalPadding,
    paddingVertical: editProfilePolicy.toastVerticalPadding,
    borderRadius: editProfilePolicy.toastRadius,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  toastText: {
    color: "#FFFFFF",
    fontSize: editProfilePolicy.toastFontSize,
    fontWeight: "500",
    textAlign: "center",
  },
});
