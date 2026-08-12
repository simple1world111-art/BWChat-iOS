import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
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

import {
  ProfileGroupedCard,
  ProfileNoticeBanner,
  ProfileRowDivider,
} from "@/components/profile/ProfileSettingsChrome";
import { TopToast } from "@/components/TopToast";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  accountComplianceErrorCode,
  accountComplianceFallbackMessage,
  createAccountEmailVerificationSession,
  getAccountSecurity,
  resendAccountEmailVerificationSession,
  verifyAccountEmail,
  type AccountSecuritySummary,
  type VerificationSession,
} from "@/services/account/AccountComplianceService";
import { colors } from "@/theme";

type EmailSecurityPhase = "current" | "request" | "verification";

export default function EmailSecurityScreen() {
  const { t } = useLocalization();
  const { isSessionUnverified } = useAuth();
  const mounted = useRef(true);
  const generation = useRef(0);
  const submitLock = useRef(false);
  const [phase, setPhase] = useState<EmailSecurityPhase>("current");
  const [summary, setSummary] = useState<AccountSecuritySummary | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [session, setSession] = useState<VerificationSession | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [isLoading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const resendSeconds = session
    ? secondsUntil(session.resendAvailableAt, session.serverTime, receivedAt, now)
    : 0;
  const canProceed =
    !isLoading &&
    (phase === "current"
      ? summary !== null
      : phase === "request"
        ? currentPassword.length > 0 && email.trim().length > 0
        : /^\d{6}$/u.test(code));

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

  const load = useCallback(async () => {
    if (isSessionUnverified) return;
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    setLoading(true);
    try {
      const next = await getAccountSecurity();
      if (current()) setSummary(next);
    } catch (error) {
      if (current()) setToast(accountError(error, t));
    } finally {
      if (current()) setLoading(false);
    }
  }, [isSessionUnverified, t]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const requestVerification = async (resend = false) => {
    if (submitLock.current || isLoading) return;
    if (!resend && (!currentPassword || !email.trim())) return;
    if (resend && (!session || resendSeconds > 0)) return;
    submitLock.current = true;
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    Keyboard.dismiss();
    setLoading(true);
    setToast(null);
    try {
      const next = resend
        ? await resendAccountEmailVerificationSession(session!.sessionId)
        : await createAccountEmailVerificationSession({ currentPassword, email });
      if (!current()) return;
      setCurrentPassword("");
      setSession(next);
      setReceivedAt(Date.now());
      setNow(Date.now());
      setCode("");
      setPhase("verification");
    } catch (error) {
      if (current()) setToast(accountError(error, t));
    } finally {
      submitLock.current = false;
      if (current()) setLoading(false);
    }
  };

  const verify = async () => {
    if (!session || !/^\d{6}$/u.test(code) || submitLock.current || isLoading) return;
    submitLock.current = true;
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    Keyboard.dismiss();
    setLoading(true);
    setToast(null);
    try {
      await verifyAccountEmail(session.sessionId, code);
      if (!current()) return;
      const next = await getAccountSecurity();
      if (!current()) return;
      setSummary(next);
      setCode("");
      setEmail("");
      setSession(null);
      setPhase("current");
      setToast(t("account.email.updated"));
    } catch (error) {
      if (current()) setToast(accountError(error, t));
    } finally {
      submitLock.current = false;
      if (current()) setLoading(false);
    }
  };

  if (isSessionUnverified) {
    return (
      <>
        <Stack.Screen options={{ title: t("account.email.security") }} />
        <View style={styles.offline}>
          <ProfileNoticeBanner message={t("account.security.onlineRequired")} />
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.button}>
            <Text style={styles.buttonText}>{t("common.back")}</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t("account.email.security") }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {phase === "current" ? (
          <ProfileGroupedCard>
            <View style={styles.summaryRow}>
              <View style={styles.icon}>
                <SymbolView name="envelope.fill" size={18} tintColor="#FFFFFF" />
              </View>
              <View style={styles.copy}>
                <Text style={styles.title}>{t("account.email.current")}</Text>
                <Text style={styles.value}>
                  {summary?.email.verified
                    ? t("account.email.verifiedValue", summary.email.maskedEmail ?? "")
                    : t("account.email.unbound")}
                </Text>
              </View>
            </View>
          </ProfileGroupedCard>
        ) : null}

        {phase === "request" ? (
          <ProfileGroupedCard>
            <InputRow
              label={t("password.current")}
              placeholder={t("password.current.placeholder")}
              secure
              disabled={isLoading}
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <ProfileRowDivider />
            <InputRow
              label={t("account.email.new")}
              placeholder={t("account.email.placeholder")}
              email
              disabled={isLoading}
              value={email}
              onChange={setEmail}
            />
          </ProfileGroupedCard>
        ) : null}

        {phase === "verification" ? (
          <>
            <ProfileNoticeBanner message={t("account.codeSent", session?.maskedEmail ?? email)} />
            <ProfileGroupedCard>
              <InputRow
                label={t("account.verificationCode")}
                placeholder={t("account.verificationCode.placeholder")}
                code
                disabled={isLoading}
                value={code}
                onChange={(value) => setCode(value.replace(/[^0-9]/gu, "").slice(0, 6))}
              />
            </ProfileGroupedCard>
          </>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: isLoading, disabled: !canProceed }}
          disabled={!canProceed}
          onPress={() => {
            if (phase === "current") setPhase("request");
            else if (phase === "request") void requestVerification(false);
            else void verify();
          }}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
            !canProceed && styles.disabled,
          ]}
        >
          {isLoading ? <ActivityIndicator color="#FFFFFF" /> : null}
          <Text style={styles.buttonText}>
            {t(
              phase === "current"
                ? summary?.email.verified
                  ? "account.email.change"
                  : "account.email.bind"
                : phase === "request"
                  ? "account.sendVerificationCode"
                  : "account.email.verifyAndSave",
            )}
          </Text>
        </Pressable>

        {phase === "verification" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: resendSeconds > 0 || isLoading }}
            disabled={resendSeconds > 0 || isLoading}
            onPress={() => void requestVerification(true)}
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>
              {resendSeconds > 0
                ? t("account.resendCountdown", resendSeconds)
                : t("account.resendCode")}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <TopToast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

function InputRow({
  label,
  placeholder,
  value,
  secure = false,
  email = false,
  code = false,
  disabled = false,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  secure?: boolean;
  email?: boolean;
  code?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.inputRow}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ busy: disabled, disabled }}
        autoCapitalize="none"
        autoComplete={code ? "one-time-code" : email ? "email" : "password"}
        autoCorrect={false}
        editable={!disabled}
        inputMode={code ? "numeric" : email ? "email" : "text"}
        keyboardType={code ? "number-pad" : email ? "email-address" : "default"}
        maxLength={code ? 6 : undefined}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryText}
        secureTextEntry={secure}
        style={styles.input}
        textContentType={code ? "oneTimeCode" : email ? "emailAddress" : "password"}
        value={value}
        onChangeText={onChange}
      />
    </View>
  );
}

function secondsUntil(targetTime: string, serverTime: string, receivedAt: number, now: number) {
  const target = Date.parse(targetTime);
  const server = Date.parse(serverTime);
  if (!Number.isFinite(target) || !Number.isFinite(server) || receivedAt <= 0) return 0;
  return Math.max(0, Math.ceil((target - server - Math.max(0, now - receivedAt)) / 1_000));
}

function accountError(
  error: unknown,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const code = accountComplianceErrorCode(error);
  const keys: Record<string, string> = {
    INVALID_EMAIL: "account.error.invalidEmail",
    EMAIL_ALREADY_IN_USE: "account.error.emailInUse",
    INVALID_VERIFICATION_CODE: "account.error.invalidCode",
    VERIFICATION_EXPIRED: "account.error.verificationExpired",
    TOO_MANY_ATTEMPTS: "account.error.tooManyAttempts",
    RATE_LIMITED: "account.error.rateLimited",
    EMAIL_DELIVERY_UNAVAILABLE: "account.error.emailUnavailable",
    INVALID_CURRENT_PASSWORD: "account.error.invalidCurrentPassword",
  };
  if (code && keys[code]) return t(keys[code]!);
  return accountComplianceFallbackMessage(error, t);
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 30,
    rowGap: 16,
    backgroundColor: colors.background,
  },
  offline: { flex: 1, padding: 16, rowGap: 16, backgroundColor: colors.background },
  summaryRow: { minHeight: 56, flexDirection: "row", alignItems: "center", columnGap: 13 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  copy: { flex: 1, rowGap: 4 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  value: { color: colors.secondaryText, fontSize: 14, fontWeight: "500" },
  inputRow: { minHeight: 62, paddingVertical: 5, rowGap: 6 },
  inputLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  input: { minHeight: 32, padding: 0, color: colors.text, fontSize: 15 },
  button: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
    borderRadius: 16,
    backgroundColor: colors.accent,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.55 },
});
