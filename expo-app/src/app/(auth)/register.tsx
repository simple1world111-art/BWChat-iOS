import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AuthCatFormStack,
  AuthFieldChrome,
  AuthFormCard,
  AuthInlineMessage,
  AuthPrimaryButton,
  AuthTitleLockup,
  authLayout,
  authPalette,
  configureAuthFocusShiftAnimation,
  KeyboardDoneAccessory,
  type AuthCatMood,
} from "@/components/auth/AuthChrome";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  accountComplianceErrorCode,
  accountComplianceFallbackMessage,
  createClientRequestId,
  createRegistrationEmailVerificationSession,
  resendRegistrationEmailVerificationSession,
  verifyRegistrationEmail,
  type RegistrationVerification,
  type VerificationSession,
} from "@/services/account/AccountComplianceService";
import {
  acquireAuthSubmission,
  isBlank,
  isRegisterFormEnabled,
  localizedRegisterError,
  registerValidationHint,
  releaseAuthSubmission,
} from "@/services/auth/authFormPolicy";

type RegistrationPhase = "credentials" | "email_verification";
type FocusedField =
  "username" | "nickname" | "password" | "confirmPassword" | "email" | "code" | null;
const inputAccessoryID = "bbchat.auth.register.keyboard";
const focusedFieldKeyboardScrollCorrection: Record<Exclude<FocusedField, null>, number> = {
  username: 0,
  nickname: 0,
  // SwiftUI's ScrollView automatically raises the password field while the
  // confirmation field settles at the editing baseline on the fixed viewport.
  password: -47,
  confirmPassword: 0,
  email: 0,
  code: 0,
};

export default function RegisterScreen() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const usernameRef = useRef<TextInput>(null);
  const nicknameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);
  const submissionLock = useRef(false);
  const mountedRef = useRef(true);
  const operationGenerationRef = useRef(0);
  const registrationRequestIdRef = useRef<string | null>(null);
  const { signUp } = useAuth();
  const { t } = useLocalization();
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phase, setPhase] = useState<RegistrationPhase>("credentials");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [verificationSession, setVerificationSession] = useState<VerificationSession | null>(null);
  const [verificationReceivedAt, setVerificationReceivedAt] = useState(0);
  const [registrationVerification, setRegistrationVerification] =
    useState<RegistrationVerification | null>(null);
  const [clockNow, setClockNow] = useState(Date.now);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<FocusedField>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compactViewportCorrection = height < 900 ? -3 : 0;

  const isEditing = focusedField !== null;
  const changeFocus = (next: FocusedField) => {
    if ((focusedField === null) !== (next === null)) configureAuthFocusShiftAnimation();
    setFocusedField(next);
  };
  const mood: AuthCatMood =
    focusedField === "username" || focusedField === "nickname" || focusedField === "email"
      ? "peek"
      : focusedField === "password" || focusedField === "confirmPassword" || focusedField === "code"
        ? "coverEyes"
        : "idle";
  const credentialsEnabled = isRegisterFormEnabled(
    username,
    password,
    confirmPassword,
    isSubmitting,
  );
  const emailEnabled = !isBlank(email) && !isSubmitting;
  const verificationEnabled = /^\d{6}$/u.test(code) && !isSubmitting;
  const validationHint = registerValidationHint(username, password, confirmPassword, t);
  const resendSeconds = verificationSession
    ? secondsUntil(
        verificationSession.resendAvailableAt,
        verificationSession.serverTime,
        verificationReceivedAt,
        clockNow,
      )
    : 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!verificationSession || resendSeconds <= 0) return;
    const timer = setInterval(() => setClockNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [resendSeconds, verificationSession]);

  const continueToEmail = () => {
    if (!credentialsEnabled || !acquireAuthSubmission(submissionLock)) return;
    releaseAuthSubmission(submissionLock);
    Keyboard.dismiss();
    changeFocus(null);
    setError(null);
    setPhase("email_verification");
  };

  const sendCode = async (resend = false) => {
    if ((!resend && !emailEnabled) || (resend && (!verificationSession || resendSeconds > 0))) {
      return;
    }
    if (!acquireAuthSubmission(submissionLock)) return;
    const generation = ++operationGenerationRef.current;
    const isCurrent = () => mountedRef.current && generation === operationGenerationRef.current;
    Keyboard.dismiss();
    changeFocus(null);
    setIsSubmitting(true);
    setError(null);
    try {
      const next = resend
        ? await resendRegistrationEmailVerificationSession(verificationSession!.sessionId)
        : await createRegistrationEmailVerificationSession(email);
      if (!isCurrent()) return;
      setVerificationSession(next);
      setVerificationReceivedAt(Date.now());
      setRegistrationVerification(null);
      registrationRequestIdRef.current = null;
      setCode("");
      setClockNow(Date.now());
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (nextError) {
      if (isCurrent()) setError(localizedComplianceError(nextError, t));
    } finally {
      releaseAuthSubmission(submissionLock);
      if (isCurrent()) setIsSubmitting(false);
    }
  };

  const createAccount = async () => {
    if (!verificationSession || !verificationEnabled || !acquireAuthSubmission(submissionLock)) {
      return;
    }
    const generation = ++operationGenerationRef.current;
    const isCurrent = () => mountedRef.current && generation === operationGenerationRef.current;
    Keyboard.dismiss();
    changeFocus(null);
    setIsSubmitting(true);
    setError(null);
    try {
      let verified = registrationVerification;
      if (!verified) {
        verified = await verifyRegistrationEmail(verificationSession.sessionId, code);
        if (!isCurrent()) return;
        setRegistrationVerification(verified);
      }
      const clientRequestId = registrationRequestIdRef.current ?? createClientRequestId();
      registrationRequestIdRef.current = clientRequestId;
      const committed = await signUp({
        username,
        password,
        nickname: isBlank(nickname) ? "" : nickname,
        email: verified.normalizedEmail,
        emailVerificationToken: verified.emailVerificationToken,
        clientRequestId,
      });
      if (!committed || !isCurrent()) return;
      registrationRequestIdRef.current = null;
      router.replace("/(tabs)/conversations");
    } catch (nextError) {
      if (isCurrent()) {
        const errorCode = accountComplianceErrorCode(nextError);
        if (errorCode === "VERIFICATION_EXPIRED") {
          setRegistrationVerification(null);
          setVerificationSession(null);
          setVerificationReceivedAt(0);
          registrationRequestIdRef.current = null;
        }
        setError(
          registrationVerification
            ? localizedRegisterError(nextError, t)
            : localizedComplianceError(nextError, t),
        );
      }
    } finally {
      releaseAuthSubmission(submissionLock);
      if (isCurrent()) setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoider}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets={false}
          contentContainerStyle={[
            styles.content,
            {
              minHeight: isEditing ? undefined : height,
              paddingBottom: Math.max(insets.bottom, 14),
              // Match the safe-area coordinate space used by the original
              // SwiftUI GeometryReader while preserving its centered VStack.
              transform: [
                {
                  translateY:
                    (isEditing ? 63.6666666667 : 15.6666666667) +
                    compactViewportCorrection +
                    (focusedField ? focusedFieldKeyboardScrollCorrection[focusedField] : 0),
                },
              ],
            },
          ]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessible={false}
            onPress={() => {
              Keyboard.dismiss();
              changeFocus(null);
            }}
            style={StyleSheet.absoluteFill}
            testID="auth-register-background-dismiss"
          />
          <View style={{ height: authLayout.registerTopSpacing(height, isEditing) }} />
          <View style={styles.registerTitleCorrection}>
            <AuthTitleLockup
              title={t("auth.register.title")}
              subtitle={
                phase === "credentials"
                  ? t("auth.register.subtitle")
                  : t("auth.register.email.subtitle")
              }
              spacing={10}
            />
          </View>
          <View style={{ height: isEditing ? 10 : 16 }} />

          <AuthCatFormStack mood={mood}>
            {phase === "credentials" ? (
              <AuthFormCard rowGap={13}>
                <AuthFieldChrome
                  symbol="person.fill"
                  isFocused={focusedField === "username"}
                  onPress={() => usernameRef.current?.focus()}
                >
                  <TextInput
                    ref={usernameRef}
                    accessibilityLabel={t("auth.username.rules")}
                    accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
                    allowFontScaling={false}
                    autoCapitalize="none"
                    autoCorrect={false}
                    inputAccessoryViewID={inputAccessoryID}
                    onBlur={() => (focusedField === "username" ? changeFocus(null) : undefined)}
                    editable={!isSubmitting}
                    onChangeText={(value) => {
                      setUsername(value);
                      registrationRequestIdRef.current = null;
                    }}
                    onFocus={() => changeFocus("username")}
                    onSubmitEditing={() => nicknameRef.current?.focus()}
                    placeholder={t("auth.username.rules")}
                    placeholderTextColor={authPalette.placeholderText}
                    returnKeyType="next"
                    style={styles.input}
                    textContentType="username"
                    value={username}
                  />
                  {username.length > 0 ? (
                    <ClearButton
                      accessibilityLabel={t("common.clear")}
                      onPress={() => setUsername("")}
                    />
                  ) : null}
                </AuthFieldChrome>

                <AuthFieldChrome
                  symbol="face.smiling"
                  isFocused={focusedField === "nickname"}
                  onPress={() => nicknameRef.current?.focus()}
                >
                  <TextInput
                    ref={nicknameRef}
                    accessibilityLabel={t("auth.nickname.optional")}
                    accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
                    allowFontScaling={false}
                    autoCapitalize="none"
                    autoCorrect={false}
                    inputAccessoryViewID={inputAccessoryID}
                    onBlur={() => (focusedField === "nickname" ? changeFocus(null) : undefined)}
                    editable={!isSubmitting}
                    onChangeText={(value) => {
                      setNickname(value);
                      registrationRequestIdRef.current = null;
                    }}
                    onFocus={() => changeFocus("nickname")}
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    placeholder={t("auth.nickname.optional")}
                    placeholderTextColor={authPalette.placeholderText}
                    returnKeyType="next"
                    style={styles.input}
                    value={nickname}
                  />
                  {nickname.length > 0 ? (
                    <ClearButton
                      accessibilityLabel={t("common.clear")}
                      onPress={() => setNickname("")}
                    />
                  ) : null}
                </AuthFieldChrome>

                <AuthFieldChrome
                  symbol="lock.fill"
                  isFocused={focusedField === "password"}
                  onPress={() => passwordRef.current?.focus()}
                >
                  <TextInput
                    ref={passwordRef}
                    accessibilityLabel={t("auth.password.rules")}
                    accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
                    allowFontScaling={false}
                    editable={!isSubmitting}
                    inputAccessoryViewID={inputAccessoryID}
                    onBlur={() => (focusedField === "password" ? changeFocus(null) : undefined)}
                    onChangeText={(value) => {
                      setPassword(value);
                      registrationRequestIdRef.current = null;
                    }}
                    onFocus={() => changeFocus("password")}
                    onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                    placeholder={t("auth.password.rules")}
                    placeholderTextColor={authPalette.placeholderText}
                    returnKeyType="next"
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    textContentType="newPassword"
                    value={password}
                  />
                  <PasswordVisibilityButton
                    hideLabel={t("password.hide")}
                    showLabel={t("password.show")}
                    visible={showPassword}
                    onPress={() => setShowPassword((current) => !current)}
                  />
                </AuthFieldChrome>

                <AuthFieldChrome
                  symbol="lock.rotation"
                  isFocused={focusedField === "confirmPassword"}
                  onPress={() => confirmPasswordRef.current?.focus()}
                >
                  <TextInput
                    ref={confirmPasswordRef}
                    accessibilityLabel={t("auth.confirmPassword")}
                    accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
                    allowFontScaling={false}
                    editable={!isSubmitting}
                    inputAccessoryViewID={inputAccessoryID}
                    onBlur={() =>
                      focusedField === "confirmPassword" ? changeFocus(null) : undefined
                    }
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      registrationRequestIdRef.current = null;
                    }}
                    onFocus={() => changeFocus("confirmPassword")}
                    onSubmitEditing={continueToEmail}
                    placeholder={t("auth.confirmPassword")}
                    placeholderTextColor={authPalette.placeholderText}
                    returnKeyType="go"
                    secureTextEntry={!showConfirmPassword}
                    style={styles.input}
                    textContentType="newPassword"
                    value={confirmPassword}
                  />
                  <PasswordVisibilityButton
                    hideLabel={t("password.hide")}
                    showLabel={t("password.show")}
                    visible={showConfirmPassword}
                    onPress={() => setShowConfirmPassword((current) => !current)}
                  />
                </AuthFieldChrome>

                {validationHint ? (
                  <AuthInlineMessage
                    message={validationHint}
                    symbol="info.circle.fill"
                    color={authPalette.mutedText}
                  />
                ) : error !== null ? (
                  <AuthInlineMessage message={error} />
                ) : null}

                <AuthPrimaryButton
                  title={t("auth.register.next")}
                  isLoading={isSubmitting}
                  isEnabled={credentialsEnabled}
                  onPress={continueToEmail}
                />

                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.back()}
                  style={styles.loginButton}
                >
                  <Text allowFontScaling={false} style={styles.loginText}>
                    {t("auth.haveAccount")}
                  </Text>
                </Pressable>
              </AuthFormCard>
            ) : (
              <AuthFormCard rowGap={13}>
                <AuthFieldChrome
                  symbol="envelope.fill"
                  isFocused={focusedField === "email"}
                  onPress={() => emailRef.current?.focus()}
                >
                  <TextInput
                    ref={emailRef}
                    accessibilityLabel={t("account.email.address")}
                    accessibilityState={{
                      busy: isSubmitting,
                      disabled: Boolean(verificationSession) || isSubmitting,
                    }}
                    allowFontScaling={false}
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    editable={!verificationSession && !isSubmitting}
                    inputAccessoryViewID={inputAccessoryID}
                    inputMode="email"
                    keyboardType="email-address"
                    onBlur={() => (focusedField === "email" ? changeFocus(null) : undefined)}
                    onChangeText={(value) => {
                      setEmail(value);
                      setVerificationSession(null);
                      setVerificationReceivedAt(0);
                      setRegistrationVerification(null);
                      registrationRequestIdRef.current = null;
                    }}
                    onFocus={() => changeFocus("email")}
                    onSubmitEditing={() => void sendCode(false)}
                    placeholder={t("account.email.placeholder")}
                    placeholderTextColor={authPalette.placeholderText}
                    returnKeyType="send"
                    style={styles.input}
                    textContentType="emailAddress"
                    value={email}
                  />
                </AuthFieldChrome>

                {verificationSession ? (
                  <AuthFieldChrome
                    symbol="number"
                    isFocused={focusedField === "code"}
                    onPress={() => codeRef.current?.focus()}
                  >
                    <TextInput
                      ref={codeRef}
                      accessibilityLabel={t("account.verificationCode")}
                      accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
                      allowFontScaling={false}
                      autoComplete="one-time-code"
                      autoCorrect={false}
                      editable={!isSubmitting}
                      inputAccessoryViewID={inputAccessoryID}
                      inputMode="numeric"
                      keyboardType="number-pad"
                      maxLength={6}
                      onBlur={() => (focusedField === "code" ? changeFocus(null) : undefined)}
                      onChangeText={(value) => {
                        setCode(value.replace(/[^0-9]/gu, "").slice(0, 6));
                        setRegistrationVerification(null);
                        registrationRequestIdRef.current = null;
                      }}
                      onFocus={() => changeFocus("code")}
                      onSubmitEditing={() => void createAccount()}
                      placeholder={t("account.verificationCode.placeholder")}
                      placeholderTextColor={authPalette.placeholderText}
                      returnKeyType="go"
                      style={styles.input}
                      textContentType="oneTimeCode"
                      value={code}
                    />
                  </AuthFieldChrome>
                ) : null}

                {verificationSession?.maskedEmail ? (
                  <AuthInlineMessage
                    message={t("account.codeSent", verificationSession.maskedEmail)}
                    symbol="checkmark.circle.fill"
                    color={authPalette.tailGreen}
                  />
                ) : null}
                {error ? <AuthInlineMessage message={error} /> : null}

                <AuthPrimaryButton
                  title={t(
                    verificationSession
                      ? "auth.register.createAccount"
                      : "account.sendVerificationCode",
                  )}
                  isLoading={isSubmitting}
                  isEnabled={verificationSession ? verificationEnabled : emailEnabled}
                  onPress={() =>
                    verificationSession ? void createAccount() : void sendCode(false)
                  }
                />

                {verificationSession ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: resendSeconds > 0 || isSubmitting }}
                    disabled={resendSeconds > 0 || isSubmitting}
                    onPress={() => void sendCode(true)}
                    style={styles.secondaryButton}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[styles.loginText, resendSeconds > 0 && styles.secondaryDisabled]}
                    >
                      {resendSeconds > 0
                        ? t("account.resendCountdown", resendSeconds)
                        : t("account.resendCode")}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    operationGenerationRef.current += 1;
                    setPhase("credentials");
                    setError(null);
                    changeFocus(null);
                    Keyboard.dismiss();
                  }}
                  style={styles.secondaryButton}
                >
                  <Text allowFontScaling={false} style={styles.loginText}>
                    {t("common.back")}
                  </Text>
                </Pressable>
              </AuthFormCard>
            )}
          </AuthCatFormStack>
          <View style={{ height: isEditing ? 18 : 28 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      <KeyboardDoneAccessory doneLabel={t("common.done")} nativeID={inputAccessoryID} />
    </View>
  );
}

function ClearButton({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
    >
      <SymbolView
        name="xmark.circle.fill"
        size={15.75}
        weight="semibold"
        tintColor="rgba(107,114,128,0.55)"
      />
    </Pressable>
  );
}

function PasswordVisibilityButton({
  hideLabel,
  showLabel,
  visible,
  onPress,
}: {
  hideLabel: string;
  showLabel: string;
  visible: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={visible ? hideLabel : showLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
    >
      <SymbolView
        name={visible ? "eye.slash.fill" : "eye.fill"}
        size={15}
        style={styles.trailingSymbol}
        weight="semibold"
        tintColor="rgba(107,114,128,0.72)"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  keyboardAvoider: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    height: 50,
    paddingVertical: 0,
    color: authPalette.ink,
    fontSize: 16,
    fontWeight: "500",
  },
  loginButton: {
    minHeight: 19.3333333333,
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  loginText: {
    color: authPalette.coral,
    fontSize: 14,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.08)",
    textShadowRadius: 20,
    textShadowOffset: { width: 0, height: 10 },
  },
  registerTitleCorrection: { transform: [{ translateX: -1 / 3 }] },
  trailingSymbol: {
    width: 22,
    transform: [{ scaleX: 1.053 }, { scaleY: 1.027 }, { translateX: -0.5 }, { translateY: -1 / 6 }],
  },
  secondaryDisabled: { color: authPalette.mutedText, opacity: 0.62 },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});

function secondsUntil(
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

function localizedComplianceError(
  error: unknown,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const code = accountComplianceErrorCode(error);
  const keyByCode: Record<string, string> = {
    INVALID_EMAIL: "account.error.invalidEmail",
    EMAIL_ALREADY_IN_USE: "account.error.emailInUse",
    INVALID_VERIFICATION_CODE: "account.error.invalidCode",
    VERIFICATION_EXPIRED: "account.error.verificationExpired",
    TOO_MANY_ATTEMPTS: "account.error.tooManyAttempts",
    RATE_LIMITED: "account.error.rateLimited",
    EMAIL_DELIVERY_UNAVAILABLE: "account.error.emailUnavailable",
    IDEMPOTENCY_CONFLICT: "account.error.idempotencyConflict",
  };
  if (code && keyByCode[code]) return t(keyByCode[code]!);
  return accountComplianceFallbackMessage(error, t);
}
