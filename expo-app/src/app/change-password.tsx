import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { changePassword } from "@/api/bwchat";
import {
  ProfileGroupedCard,
  ProfileNoticeBanner,
  ProfileRowDivider,
} from "@/components/profile/ProfileSettingsChrome";
import { TopToast } from "@/components/TopToast";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  passwordChangePolicy,
  passwordChangeValidationMessage,
} from "@/services/auth/passwordChangePolicy";
import { colors } from "@/theme";

export default function ChangePasswordScreen() {
  const { t } = useLocalization();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showsCurrent, setShowsCurrent] = useState(false);
  const [showsNew, setShowsNew] = useState(false);
  const [showsConfirm, setShowsConfirm] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const submitLock = useRef(false);
  const mounted = useRef(true);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAnyInput = Boolean(currentPassword || newPassword || confirmPassword);
  const validationMessage = useMemo(
    () => passwordChangeValidationMessage(currentPassword, newPassword, confirmPassword, t),
    [confirmPassword, currentPassword, newPassword, t],
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
      await changePassword(currentPassword, newPassword);
      if (!mounted.current) return;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setToastMessage(t("password.updated"));
      navigationTimer.current = setTimeout(
        () => router.back(),
        passwordChangePolicy.successNavigationDelayMilliseconds,
      );
    } catch (error) {
      if (mounted.current) {
        setToastMessage(error instanceof Error ? error.message : t("api.networkUnavailable"));
      }
    } finally {
      submitLock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t("password.title") }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
      >
        <ProfileGroupedCard>
          <PasswordRow
            title={t("password.current")}
            placeholder={t("password.current.placeholder")}
            value={currentPassword}
            visible={showsCurrent}
            onChange={setCurrentPassword}
            onToggle={() => setShowsCurrent((value) => !value)}
            showLabel={t("password.show")}
            hideLabel={t("password.hide")}
          />
          <ProfileRowDivider />
          <PasswordRow
            title={t("password.new")}
            placeholder={t("password.new.placeholder")}
            value={newPassword}
            visible={showsNew}
            onChange={setNewPassword}
            onToggle={() => setShowsNew((value) => !value)}
            showLabel={t("password.show")}
            hideLabel={t("password.hide")}
          />
          <ProfileRowDivider />
          <PasswordRow
            title={t("password.confirm")}
            placeholder={t("password.confirm.placeholder")}
            value={confirmPassword}
            visible={showsConfirm}
            onChange={setConfirmPassword}
            onToggle={() => setShowsConfirm((value) => !value)}
            showLabel={t("password.show")}
            hideLabel={t("password.hide")}
          />
        </ProfileGroupedCard>

        {hasAnyInput && validationMessage ? (
          <ProfileNoticeBanner message={validationMessage} />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isSubmitting ? t("common.saving") : t("password.save")}
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.submit,
            !canSubmit && styles.submitDisabled,
            pressed && canSubmit && styles.pressed,
          ]}
        >
          {isSubmitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text style={styles.submitText}>
            {isSubmitting ? t("common.saving") : t("password.save")}
          </Text>
        </Pressable>
      </ScrollView>
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </>
  );
}

function PasswordRow({
  title,
  placeholder,
  value,
  visible,
  onChange,
  onToggle,
  showLabel,
  hideLabel,
}: {
  title: string;
  placeholder: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <View style={styles.passwordRow}>
      <View style={styles.passwordCopy}>
        <Text style={styles.passwordTitle}>{title}</Text>
        <TextInput
          accessibilityLabel={title}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          placeholder={placeholder}
          placeholderTextColor={colors.tertiaryText}
          secureTextEntry={!visible}
          style={styles.input}
          value={value}
          onChangeText={onChange}
        />
      </View>
      <Pressable
        accessibilityLabel={visible ? hideLabel : showLabel}
        accessibilityRole="button"
        hitSlop={8}
        style={styles.eye}
        onPress={onToggle}
      >
        <SymbolView
          name={visible ? "eye.slash" : "eye"}
          size={passwordChangePolicy.visibilitySymbolSize}
          weight="semibold"
          tintColor={colors.tertiaryText}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: passwordChangePolicy.contentHorizontalPadding,
    paddingTop: passwordChangePolicy.contentTopPadding,
    paddingBottom: passwordChangePolicy.contentBottomPadding,
    rowGap: passwordChangePolicy.contentSpacing,
    backgroundColor: colors.background,
  },
  passwordRow: {
    paddingVertical: passwordChangePolicy.rowVerticalPadding,
    flexDirection: "row",
    alignItems: "center",
    columnGap: passwordChangePolicy.rowSpacing,
  },
  passwordCopy: { flex: 1, alignItems: "flex-start", rowGap: passwordChangePolicy.fieldSpacing },
  passwordTitle: {
    color: colors.text,
    fontSize: passwordChangePolicy.titleFontSize,
    fontWeight: "600",
  },
  input: {
    width: "100%",
    padding: 0,
    color: colors.text,
    fontSize: passwordChangePolicy.inputFontSize,
  },
  eye: {
    width: passwordChangePolicy.visibilityButtonSize,
    height: passwordChangePolicy.visibilityButtonSize,
    alignItems: "center",
    justifyContent: "center",
  },
  submit: {
    minHeight: passwordChangePolicy.submitMinimumHeight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: passwordChangePolicy.submitSpacing,
    borderRadius: passwordChangePolicy.submitRadius,
    backgroundColor: colors.accent,
  },
  submitDisabled: { backgroundColor: colors.tertiaryText },
  submitText: {
    color: "#FFFFFF",
    fontSize: passwordChangePolicy.submitFontSize,
    fontWeight: "600",
  },
  pressed: { opacity: 0.72 },
});
