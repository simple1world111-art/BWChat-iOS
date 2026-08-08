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
  acquireAuthSubmission,
  isBlank,
  isRegisterFormEnabled,
  localizedRegisterError,
  registerValidationHint,
  releaseAuthSubmission,
} from "@/services/auth/authFormPolicy";

type FocusedField = "username" | "nickname" | "password" | "confirmPassword" | null;
const inputAccessoryID = "bbchat.auth.register.keyboard";
const focusedFieldKeyboardScrollCorrection: Record<Exclude<FocusedField, null>, number> = {
  username: 0,
  nickname: 0,
  // SwiftUI's ScrollView automatically raises the password field while the
  // confirmation field settles at the editing baseline on the fixed viewport.
  password: -47,
  confirmPassword: 0,
};

export default function RegisterScreen() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const usernameRef = useRef<TextInput>(null);
  const nicknameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const submissionLock = useRef(false);
  const mountedRef = useRef(true);
  const { signUp } = useAuth();
  const { t } = useLocalization();
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
    focusedField === "username" || focusedField === "nickname"
      ? "peek"
      : focusedField === "password" || focusedField === "confirmPassword"
        ? "coverEyes"
        : "idle";
  const isEnabled = isRegisterFormEnabled(username, password, confirmPassword, isSubmitting);
  const validationHint = registerValidationHint(username, password, confirmPassword, t);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async () => {
    if (!isEnabled || !acquireAuthSubmission(submissionLock)) return;
    Keyboard.dismiss();
    changeFocus(null);
    setIsSubmitting(true);
    setError(null);
    try {
      const committed = await signUp(username, password, isBlank(nickname) ? "" : nickname);
      if (!committed || !mountedRef.current) return;
      router.replace("/(tabs)/conversations");
    } catch (nextError) {
      if (mountedRef.current) setError(localizedRegisterError(nextError, t));
    } finally {
      releaseAuthSubmission(submissionLock);
      if (mountedRef.current) setIsSubmitting(false);
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
              subtitle={t("auth.register.subtitle")}
              spacing={10}
            />
          </View>
          <View style={{ height: isEditing ? 10 : 16 }} />

          <AuthCatFormStack mood={mood}>
            <AuthFormCard rowGap={13}>
              <AuthFieldChrome
                symbol="person.fill"
                isFocused={focusedField === "username"}
                onPress={() => usernameRef.current?.focus()}
              >
                <TextInput
                  ref={usernameRef}
                  allowFontScaling={false}
                  autoCapitalize="none"
                  autoCorrect={false}
                  inputAccessoryViewID={inputAccessoryID}
                  onBlur={() => (focusedField === "username" ? changeFocus(null) : undefined)}
                  onChangeText={setUsername}
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
                  allowFontScaling={false}
                  autoCapitalize="none"
                  autoCorrect={false}
                  inputAccessoryViewID={inputAccessoryID}
                  onBlur={() => (focusedField === "nickname" ? changeFocus(null) : undefined)}
                  onChangeText={setNickname}
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
                  allowFontScaling={false}
                  inputAccessoryViewID={inputAccessoryID}
                  onBlur={() => (focusedField === "password" ? changeFocus(null) : undefined)}
                  onChangeText={setPassword}
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
                  allowFontScaling={false}
                  inputAccessoryViewID={inputAccessoryID}
                  onBlur={() =>
                    focusedField === "confirmPassword" ? changeFocus(null) : undefined
                  }
                  onChangeText={setConfirmPassword}
                  onFocus={() => changeFocus("confirmPassword")}
                  onSubmitEditing={() => void submit()}
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
                title={t("auth.register.action")}
                isLoading={isSubmitting}
                isEnabled={isEnabled}
                onPress={() => void submit()}
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
});
