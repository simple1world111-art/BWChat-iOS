import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
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

import {
  AuthFieldChrome,
  AuthFormCard,
  AuthInlineMessage,
  AuthPrimaryButton,
  AuthTitleLockup,
  authPalette,
} from "@/components/auth/AuthChrome";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  accountComplianceErrorCode,
  accountComplianceFallbackMessage,
  confirmPasswordReset,
  createClientRequestId,
  createPasswordResetSession,
  resendPasswordResetSession,
  type VerificationSession,
} from "@/services/account/AccountComplianceService";
import {
  copySupportEmail,
  normalizedSupportEmail,
  openSupportEmail,
} from "@/services/account/SupportEmailService";
import { newPasswordValidationMessage } from "@/services/auth/passwordChangePolicy";

type PasswordResetPhase = "identifier" | "verification" | "success";

export default function ForgotPasswordScreen() {
  const { t } = useLocalization();
  const { config } = useRemoteConfig();
  const supportEmail = normalizedSupportEmail(config.account?.supportEmail);
  const mounted = useRef(true);
  const generation = useRef(0);
  const submitLock = useRef(false);
  const requestId = useRef<string | null>(null);
  const [phase, setPhase] = useState<PasswordResetPhase>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [session, setSession] = useState<VerificationSession | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resendSeconds = session
    ? verificationSeconds(session.resendAvailableAt, session.serverTime, receivedAt, now)
    : 0;
  const passwordValidation = newPasswordValidationMessage(newPassword, confirmPassword, t);
  const canConfirm = /^\d{6}$/u.test(code) && passwordValidation === null && !isSubmitting;

  useEffect(
    () => () => {
      mounted.current = false;
      generation.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!session || resendSeconds <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [resendSeconds, session]);

  const begin = async (resend = false) => {
    if (submitLock.current || isSubmitting || (!resend && identifier.trim().length === 0)) return;
    if (resend && (!session || resendSeconds > 0)) return;
    submitLock.current = true;
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    Keyboard.dismiss();
    setSubmitting(true);
    setError(null);
    try {
      const next = resend
        ? await resendPasswordResetSession(session!.sessionId)
        : await createPasswordResetSession(identifier);
      if (!current()) return;
      setSession(next);
      setReceivedAt(Date.now());
      setNow(Date.now());
      setPhase("verification");
      setCode("");
      requestId.current = null;
    } catch (nextError) {
      if (current()) setError(resetError(nextError, t));
    } finally {
      submitLock.current = false;
      if (current()) setSubmitting(false);
    }
  };

  const confirm = async () => {
    if (!session || !canConfirm || submitLock.current) return;
    submitLock.current = true;
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    const clientRequestId = requestId.current ?? createClientRequestId();
    requestId.current = clientRequestId;
    Keyboard.dismiss();
    setSubmitting(true);
    setError(null);
    try {
      await confirmPasswordReset({
        sessionId: session.sessionId,
        code,
        newPassword,
        clientRequestId,
      });
      if (!current()) return;
      requestId.current = null;
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setPhase("success");
    } catch (nextError) {
      if (current()) setError(resetError(nextError, t));
    } finally {
      submitLock.current = false;
      if (current()) setSubmitting(false);
    }
  };

  const contactSupport = async () => {
    if (!supportEmail) {
      Alert.alert(t("common.notice"), t("account.support.unavailable"));
      return;
    }
    if (await openSupportEmail(supportEmail)) return;
    Alert.alert(t("account.support.openFailed.title"), t("account.support.openFailed.message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("account.support.copy"),
        onPress: () => void copySupportEmail(supportEmail),
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoider}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AuthTitleLockup
            title={t("password.reset.title")}
            subtitle={t("password.reset.subtitle")}
          />
          <AuthFormCard rowGap={13}>
            {phase === "identifier" ? (
              <>
                <AuthFieldChrome symbol="person.fill" isFocused={focused === "identifier"}>
                  <TextInput
                    accessibilityLabel={t("password.reset.identifier")}
                    accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSubmitting}
                    onBlur={() => setFocused(null)}
                    onChangeText={setIdentifier}
                    onFocus={() => setFocused("identifier")}
                    onSubmitEditing={() => void begin(false)}
                    placeholder={t("password.reset.identifier.placeholder")}
                    placeholderTextColor={authPalette.placeholderText}
                    returnKeyType="send"
                    style={styles.input}
                    textContentType="username"
                    value={identifier}
                  />
                </AuthFieldChrome>
                {error ? <AuthInlineMessage message={error} /> : null}
                <AuthPrimaryButton
                  title={t("account.sendVerificationCode")}
                  isEnabled={identifier.trim().length > 0 && !isSubmitting}
                  isLoading={isSubmitting}
                  onPress={() => void begin(false)}
                />
              </>
            ) : phase === "verification" ? (
              <>
                <AuthInlineMessage
                  message={t("password.reset.genericSent")}
                  symbol="checkmark.circle.fill"
                  color={authPalette.tailGreen}
                />
                <AuthFieldChrome symbol="number" isFocused={focused === "code"}>
                  <TextInput
                    accessibilityLabel={t("account.verificationCode")}
                    accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
                    autoComplete="one-time-code"
                    editable={!isSubmitting}
                    inputMode="numeric"
                    keyboardType="number-pad"
                    maxLength={6}
                    onBlur={() => setFocused(null)}
                    onChangeText={(value) => {
                      setCode(value.replace(/[^0-9]/gu, "").slice(0, 6));
                      requestId.current = null;
                    }}
                    onFocus={() => setFocused("code")}
                    placeholder={t("account.verificationCode.placeholder")}
                    placeholderTextColor={authPalette.placeholderText}
                    style={styles.input}
                    textContentType="oneTimeCode"
                    value={code}
                  />
                </AuthFieldChrome>
                <SecretField
                  accessibilityLabel={t("password.new")}
                  focused={focused === "newPassword"}
                  placeholder={t("password.new.placeholder")}
                  disabled={isSubmitting}
                  value={newPassword}
                  onBlur={() => setFocused(null)}
                  onChange={(value) => {
                    setNewPassword(value);
                    requestId.current = null;
                  }}
                  onFocus={() => setFocused("newPassword")}
                />
                <SecretField
                  accessibilityLabel={t("password.confirm")}
                  focused={focused === "confirmPassword"}
                  placeholder={t("password.confirm.placeholder")}
                  disabled={isSubmitting}
                  value={confirmPassword}
                  onBlur={() => setFocused(null)}
                  onChange={(value) => {
                    setConfirmPassword(value);
                    requestId.current = null;
                  }}
                  onFocus={() => setFocused("confirmPassword")}
                />
                {newPassword || confirmPassword ? (
                  passwordValidation ? (
                    <AuthInlineMessage message={passwordValidation} />
                  ) : null
                ) : null}
                {error ? <AuthInlineMessage message={error} /> : null}
                <AuthPrimaryButton
                  title={t("password.reset.confirm")}
                  isEnabled={canConfirm}
                  isLoading={isSubmitting}
                  onPress={() => void confirm()}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: resendSeconds > 0 || isSubmitting }}
                  disabled={resendSeconds > 0 || isSubmitting}
                  onPress={() => void begin(true)}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkText}>
                    {resendSeconds > 0
                      ? t("account.resendCountdown", resendSeconds)
                      : t("account.resendCode")}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <AuthInlineMessage
                  message={t("password.reset.success")}
                  symbol="checkmark.circle.fill"
                  color={authPalette.tailGreen}
                />
                <AuthPrimaryButton
                  title={t("password.reset.backToLogin")}
                  isEnabled
                  isLoading={false}
                  onPress={() => router.replace("/(auth)/login")}
                />
              </>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => void contactSupport()}
              style={styles.linkButton}
            >
              <Text style={styles.supportText}>{t("account.support.cannotReceive")}</Text>
            </Pressable>
            {phase !== "success" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>{t("common.back")}</Text>
              </Pressable>
            ) : null}
          </AuthFormCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function SecretField({
  accessibilityLabel,
  focused,
  placeholder,
  disabled,
  value,
  onBlur,
  onChange,
  onFocus,
}: {
  accessibilityLabel: string;
  focused: boolean;
  placeholder: string;
  disabled: boolean;
  value: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  onFocus: () => void;
}) {
  return (
    <AuthFieldChrome symbol="lock.fill" isFocused={focused}>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ busy: disabled, disabled }}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        onBlur={onBlur}
        onChangeText={onChange}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={authPalette.placeholderText}
        secureTextEntry
        style={styles.input}
        textContentType="newPassword"
        value={value}
      />
    </AuthFieldChrome>
  );
}

function verificationSeconds(
  targetTime: string,
  serverTime: string,
  receivedAt: number,
  now: number,
): number {
  const target = Date.parse(targetTime);
  const server = Date.parse(serverTime);
  if (!Number.isFinite(target) || !Number.isFinite(server) || receivedAt <= 0) return 0;
  return Math.max(0, Math.ceil((target - server - Math.max(0, now - receivedAt)) / 1_000));
}

function resetError(
  error: unknown,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const code = accountComplianceErrorCode(error);
  const keys: Record<string, string> = {
    INVALID_VERIFICATION_CODE: "account.error.invalidCode",
    VERIFICATION_EXPIRED: "account.error.verificationExpired",
    TOO_MANY_ATTEMPTS: "account.error.tooManyAttempts",
    RATE_LIMITED: "account.error.rateLimited",
    EMAIL_DELIVERY_UNAVAILABLE: "account.error.emailUnavailable",
    PASSWORD_POLICY_VIOLATION: "account.error.passwordPolicy",
    IDEMPOTENCY_CONFLICT: "account.error.idempotencyConflict",
  };
  if (code && keys[code]) return t(keys[code]!);
  return accountComplianceFallbackMessage(error, t);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  keyboardAvoider: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 48,
    justifyContent: "center",
    rowGap: 26,
    backgroundColor: "#FFFFFF",
  },
  input: {
    flex: 1,
    height: 50,
    paddingVertical: 0,
    color: authPalette.ink,
    fontSize: 16,
    fontWeight: "500",
  },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: authPalette.coral, fontSize: 14, fontWeight: "600" },
  supportText: { color: authPalette.mutedText, fontSize: 14, fontWeight: "600" },
});
