import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { updateUsername } from "@/api/bwchat";
import {
  ProfileGroupedCard,
  ProfileNoticeBanner,
} from "@/components/profile/ProfileSettingsChrome";
import { TopToast } from "@/components/TopToast";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  usernameResetError,
  usernameResetPolicy,
  usernameValidationMessage,
} from "@/services/profile/usernameResetPolicy";
import { colors } from "@/theme";

export default function UsernameResetScreen() {
  const { user, updateUser } = useAuth();
  const { activeLanguage, t } = useLocalization();
  const insets = useSafeAreaInsets();
  const currentUsername = user?.username ?? "";
  const [username, setUsername] = useState(currentUsername);
  const [isSubmitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const submitLock = useRef(false);
  const mounted = useRef(true);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimmedUsername = username.trim();
  const validationMessage = useMemo(
    () => usernameValidationMessage(username, currentUsername, t),
    [currentUsername, t, username],
  );
  const canSubmit = validationMessage === null && !isSubmitting;

  useEffect(
    () => () => {
      mounted.current = false;
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
    },
    [],
  );

  const submit = async () => {
    if (submitLock.current) return;
    if (validationMessage) {
      setToastMessage(validationMessage);
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setToastMessage(null);
    try {
      const nextUser = await updateUsername(trimmedUsername);
      await updateUser(nextUser);
      if (!mounted.current) return;
      setToastMessage(t("username.reset.updated"));
      navigationTimer.current = setTimeout(
        () => router.back(),
        usernameResetPolicy.successNavigationDelayMilliseconds,
      );
    } catch (error) {
      if (mounted.current) setToastMessage(usernameResetError(error, t, activeLanguage));
    } finally {
      submitLock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t("username.reset.title") }} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <SymbolView
              name="bubble.left.and.bubble.right.fill"
              size={usernameResetPolicy.heroIconSize}
              weight="semibold"
              tintColor="rgba(0,0,0,0.12)"
            />
            <View style={styles.heroCopy}>
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={usernameResetPolicy.heroTitleMinimumScale}
                style={styles.heroTitle}
              >
                {t("username.reset.current", currentUsername)}
              </Text>
              <Text style={styles.heroDescription}>{t("username.reset.description")}</Text>
            </View>
          </View>

          <ProfileGroupedCard>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{t("username.reset.field")}</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                enterKeyHint="done"
                accessibilityLabel={t("username.reset.field")}
                accessibilityHint={t("username.reset.description")}
                placeholder={t("username.reset.placeholder")}
                placeholderTextColor={colors.tertiaryText}
                returnKeyType="done"
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                onSubmitEditing={() => void submit()}
              />
            </View>
          </ProfileGroupedCard>

          {username.trim() && validationMessage ? (
            <ProfileNoticeBanner message={validationMessage} />
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.bottomBar,
            { paddingBottom: Math.max(insets.bottom, usernameResetPolicy.bottomMinimumPadding) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSubmitting ? t("common.saving") : t("username.reset.action")}
            disabled={!canSubmit}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.submit,
              !canSubmit && styles.submitDisabled,
              pressed && canSubmit && styles.pressed,
            ]}
          >
            {isSubmitting ? <ActivityIndicator size="small" color={colors.text} /> : null}
            <Text style={styles.submitText}>
              {isSubmitting ? t("common.saving") : t("username.reset.action")}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: usernameResetPolicy.horizontalPadding,
    paddingTop: usernameResetPolicy.heroTopPadding,
    paddingBottom: usernameResetPolicy.contentBottomPadding,
    rowGap: usernameResetPolicy.sectionSpacing,
  },
  hero: { width: "100%", alignItems: "center", rowGap: usernameResetPolicy.heroSpacing },
  heroCopy: { width: "100%", alignItems: "center", rowGap: usernameResetPolicy.heroCopySpacing },
  heroTitle: {
    color: colors.text,
    fontSize: usernameResetPolicy.heroTitleSize,
    lineHeight: 31,
    fontWeight: "700",
    textAlign: "center",
  },
  heroDescription: {
    paddingHorizontal: 10,
    color: colors.secondaryText,
    fontSize: usernameResetPolicy.heroDescriptionSize,
    lineHeight: usernameResetPolicy.heroDescriptionLineHeight,
    textAlign: "center",
  },
  fieldRow: {
    minHeight: 44,
    paddingVertical: usernameResetPolicy.fieldVerticalPadding,
    flexDirection: "row",
    alignItems: "center",
    columnGap: usernameResetPolicy.fieldSpacing,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: usernameResetPolicy.fieldFontSize,
    fontWeight: "600",
  },
  input: {
    flex: 1,
    padding: 0,
    color: colors.text,
    fontSize: usernameResetPolicy.fieldFontSize,
    fontWeight: "500",
    textAlign: "right",
  },
  bottomBar: {
    paddingHorizontal: usernameResetPolicy.bottomHorizontalPadding,
    paddingTop: usernameResetPolicy.bottomTopPadding,
    backgroundColor: "rgba(255,255,255,0.96)",
  },
  submit: {
    minHeight: usernameResetPolicy.submitMinimumHeight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
    borderRadius: usernameResetPolicy.submitRadius,
    backgroundColor: colors.background,
  },
  submitDisabled: { backgroundColor: "#EFEFEF" },
  submitText: {
    color: colors.text,
    fontSize: usernameResetPolicy.submitFontSize,
    fontWeight: "600",
  },
  pressed: { opacity: 0.72 },
});
