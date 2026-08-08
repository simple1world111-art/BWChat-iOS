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
  authPasswordVisibilitySymbolSize,
  configureAuthFocusShiftAnimation,
  KeyboardDoneAccessory,
  type AuthCatMood,
} from "@/components/auth/AuthChrome";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  acquireAuthSubmission,
  isLoginFormEnabled,
  localizedLoginError,
  releaseAuthSubmission,
} from "@/services/auth/authFormPolicy";

type FocusedField = "username" | "password" | null;
const inputAccessoryID = "bbchat.auth.login.keyboard";

export default function LoginScreen() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const submissionLock = useRef(false);
  const mountedRef = useRef(true);
  const { signIn } = useAuth();
  const { t } = useLocalization();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    focusedField === "username" ? "peek" : focusedField === "password" ? "coverEyes" : "idle";
  const isEnabled = isLoginFormEnabled(username, password, isSubmitting);

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
      const committed = await signIn(username, password);
      if (!committed || !mountedRef.current) return;
      router.replace("/(tabs)/conversations");
    } catch (nextError) {
      if (mountedRef.current) setError(localizedLoginError(nextError, t));
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
              // SwiftUI centers this screen in the GeometryReader's safe-area
              // coordinate space. React Native centers in the full window.
              transform: [{ translateY: (isEditing ? 31 : 14) + compactViewportCorrection }],
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
            testID="auth-login-background-dismiss"
          />
          <View style={{ height: authLayout.loginTopSpacing(height, isEditing) }} />
          <AuthTitleLockup title="BBchat" subtitle={t("auth.login.subtitle")} />

          <View style={{ height: isEditing ? 10 : 15 }} />
          <AuthCatFormStack mood={mood}>
            <AuthFormCard>
              <AuthFieldChrome
                symbol="person.fill"
                isFocused={focusedField === "username"}
                onPress={() => usernameRef.current?.focus()}
              >
                <TextInput
                  ref={usernameRef}
                  allowFontScaling={false}
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect={false}
                  clearButtonMode="never"
                  inputAccessoryViewID={inputAccessoryID}
                  onBlur={() => (focusedField === "username" ? changeFocus(null) : undefined)}
                  onChangeText={setUsername}
                  onFocus={() => changeFocus("username")}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  placeholder={t("auth.username")}
                  placeholderTextColor={authPalette.placeholderText}
                  returnKeyType="next"
                  style={styles.input}
                  textContentType="username"
                  value={username}
                />
                {username.length > 0 ? (
                  <Pressable
                    accessibilityLabel={t("common.clear")}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setUsername("")}
                  >
                    <SymbolView
                      name="xmark.circle.fill"
                      size={15}
                      weight="semibold"
                      tintColor="rgba(107,114,128,0.55)"
                    />
                  </Pressable>
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
                  autoComplete="current-password"
                  inputAccessoryViewID={inputAccessoryID}
                  onBlur={() => (focusedField === "password" ? changeFocus(null) : undefined)}
                  onChangeText={setPassword}
                  onFocus={() => changeFocus("password")}
                  onSubmitEditing={() => void submit()}
                  placeholder={t("auth.password")}
                  placeholderTextColor={authPalette.placeholderText}
                  returnKeyType="go"
                  secureTextEntry={!showPassword}
                  style={styles.input}
                  textContentType="password"
                  value={password}
                />
                <Pressable
                  accessibilityLabel={t(showPassword ? "password.hide" : "password.show")}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setShowPassword((current) => !current)}
                >
                  <SymbolView
                    name={showPassword ? "eye.slash.fill" : "eye.fill"}
                    size={authPasswordVisibilitySymbolSize}
                    style={styles.passwordVisibilitySymbol}
                    weight="semibold"
                    tintColor="rgba(107,114,128,0.72)"
                  />
                </Pressable>
              </AuthFieldChrome>

              {error !== null ? <AuthInlineMessage message={error} /> : null}

              <AuthPrimaryButton
                title={t("auth.login.action")}
                isLoading={isSubmitting}
                isEnabled={isEnabled}
                onPress={() => void submit()}
              />

              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/(auth)/register")}
                style={styles.registerButton}
              >
                <Text allowFontScaling={false} style={styles.noAccount}>
                  {t("auth.noAccount")}
                </Text>
                <Text allowFontScaling={false} style={styles.registerNow}>
                  {t("auth.registerNow")}
                </Text>
              </Pressable>
            </AuthFormCard>
          </AuthCatFormStack>
          <View style={{ height: isEditing ? 18 : 30 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      <KeyboardDoneAccessory doneLabel={t("common.done")} nativeID={inputAccessoryID} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  keyboardAvoider: { flex: 1 },
  // SwiftUI centers the VStack inside `.frame(minHeight: geo.size.height)`
  // whenever its intrinsic content is shorter than the viewport.
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
  registerButton: {
    minHeight: 19.3333333333,
    paddingTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 4,
    transform: [{ translateX: 1 / 3 }],
  },
  noAccount: { color: authPalette.mutedText, fontSize: 14, fontWeight: "500" },
  registerNow: { color: authPalette.coral, fontSize: 14, fontWeight: "600" },
  passwordVisibilitySymbol: { transform: [{ scaleY: 38 / 39 }] },
});
