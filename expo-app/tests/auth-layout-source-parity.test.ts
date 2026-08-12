import fs from "node:fs";
import path from "node:path";

describe("authentication layout source parity", () => {
  it("keeps auth screenshot fixtures dev-only and bypasses persisted sessions", () => {
    const acceptance = fs.readFileSync(
      path.join(process.cwd(), "src/services/visualAcceptance.ts"),
      "utf8",
    );
    const provider = fs.readFileSync(
      path.join(process.cwd(), "src/providers/AuthProvider.tsx"),
      "utf8",
    );
    const index = fs.readFileSync(path.join(process.cwd(), "src/app/index.tsx"), "utf8");
    expect(acceptance).toContain('requestedVariant === "auth-login"');
    expect(acceptance).toContain('requestedVariant === "auth-register"');
    expect(acceptance).toContain("__DEV__ &&");
    expect(provider).toContain("visualAcceptanceEnabled && !authVisualAcceptanceEnabled");
    expect(index).toContain('Redirect href="/(auth)/login"');
    expect(index).toContain('Redirect href="/(auth)/register"');
  });

  it("subscribes the provider to native-equivalent refresh and rejection events", () => {
    const provider = fs.readFileSync(
      path.join(process.cwd(), "src/providers/AuthProvider.tsx"),
      "utf8",
    );
    expect(provider).toContain("subscribeAuthSessionEvents");
    expect(provider).toContain('event.type === "refreshed"');
    expect(provider).toContain('clearAuthPersistenceBestEffort("refresh_rejected_clear")');
  });

  it("centers the login stack inside its minimum viewport height like SwiftUI", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/(auth)/login.tsx"), "utf8");
    const authChromeSource = fs.readFileSync(
      path.join(process.cwd(), "src/components/auth/AuthChrome.tsx"),
      "utf8",
    );
    expect(source).toContain("minHeight: isEditing ? undefined : height");
    expect(source).toContain("const { t } = useLocalization()");
    expect(source).toContain('t("auth.login.subtitle")');
    expect(source).toContain('t("auth.username")');
    expect(source).toContain('t("auth.password")');
    expect(source).toContain('t("auth.login.action")');
    expect(source).toContain('t("auth.noAccount")');
    expect(source).toContain('t("auth.registerNow")');
    expect(source).toContain("await signIn(username, password)");
    expect(source).toContain("if (!committed || !mountedRef.current) return");
    expect(source).toContain("const submissionLock = useRef(false)");
    expect(source).toContain("!acquireAuthSubmission(submissionLock)");
    expect(source).toContain("releaseAuthSubmission(submissionLock)");
    expect(source).toContain("error !== null");
    expect(source).toContain("onPress={() => usernameRef.current?.focus()}");
    expect(source).toContain("onPress={() => passwordRef.current?.focus()}");
    expect(source).toContain("allowFontScaling={false}");
    expect(source).toContain('<StatusBar style="dark" />');
    expect(source).toContain('testID="auth-login-background-dismiss"');
    expect(source.match(/accessibilityRole="button"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("flexGrow: 1");
    expect(source).toContain('justifyContent: "center"');
    expect(source).toContain("const compactViewportCorrection = height < 900 ? -3 : 0");
    expect(source).toContain("(isEditing ? 31 : 14) + compactViewportCorrection");
    expect(source).toContain("minHeight: 19.3333333333");
    expect(authChromeSource).toContain("padding: 16");
    expect(authChromeSource).toContain("paddingHorizontal: 16");
    expect(authChromeSource).toContain("style={styles.formCardSurface}");
    expect(authChromeSource).toContain("styles.focusedFieldSurface");
    expect(authChromeSource).toContain("top: -1 / 3");
    expect(authChromeSource).toContain("right: -1 / 3");
    expect(authChromeSource).toContain("bottom: -1 / 3");
    expect(authChromeSource).toContain("left: -1 / 3");
    expect(authChromeSource).toContain("authPasswordVisibilitySymbolSize = 23");
    expect(authChromeSource).toContain('disabledButton: { backgroundColor: "#D9DCE4" }');
    expect(authChromeSource).toContain(
      'fontFamily: Platform.select({ ios: ".AppleSystemUIFontRounded-Heavy", default: undefined })',
    );
    expect(authChromeSource).toContain("transform: [{ translateX: 1 / 3 }]");
    expect(authChromeSource).toContain("primaryButtonDisabled: { opacity: 0.6 }");
    expect(authChromeSource).toContain("primaryButtonDisabledShadow: {");
    expect(authChromeSource).toContain('Keyboard.addListener("keyboardWillChangeFrame"');
    expect(authChromeSource).toContain("style={[styles.doneButton, { bottom: keyboardHeight }]}");
    expect(authChromeSource).toContain("doneText: {");
    expect(authChromeSource).toContain("transform: [{ translateX: 1 }]");
    expect(authChromeSource).toContain("accessibilityLabel={doneLabel}");
    expect(authChromeSource).toContain("LayoutAnimation.configureNext");
    expect(authChromeSource).toContain("duration: 360");
    expect(authChromeSource).toContain("springDamping: 0.88");
    expect(source).toContain("configureAuthFocusShiftAnimation()");
    expect(authChromeSource).toContain('accessibilityLiveRegion="polite"');
    expect(authChromeSource).toContain(
      "accessibilityState={{ busy: isLoading, disabled: !isEnabled }}",
    );
    expect(authChromeSource).toContain("onPress?: (() => void) | undefined");
    expect(authChromeSource).toContain("allowFontScaling={false}");
    expect(authChromeSource).toContain("{doneLabel}");
  });

  it("centers the register stack in the same SwiftUI safe-area coordinate space", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/(auth)/register.tsx"), "utf8");
    expect(source).toContain("minHeight: isEditing ? undefined : height");
    expect(source).toContain("const { t } = useLocalization()");
    expect(source).toContain('t("auth.register.title")');
    expect(source).toContain('t("auth.register.subtitle")');
    expect(source).toContain('t("auth.username.rules")');
    expect(source).toContain('t("auth.nickname.optional")');
    expect(source).toContain('t("auth.password.rules")');
    expect(source).toContain('t("auth.confirmPassword")');
    expect(source).toContain('t("auth.register.next")');
    expect(source).toContain('t("auth.haveAccount")');
    expect(source).toContain("const committed = await signUp(");
    expect(source).toContain('isBlank(nickname) ? "" : nickname');
    expect(source).toContain("if (!committed || !isCurrent()) return");
    expect(source).toContain("const submissionLock = useRef(false)");
    expect(source).toContain("!acquireAuthSubmission(submissionLock)");
    expect(source).toContain("releaseAuthSubmission(submissionLock)");
    expect(source).toContain("error !== null");
    expect(source).toContain("onPress={() => usernameRef.current?.focus()}");
    expect(source).toContain("onPress={() => nicknameRef.current?.focus()}");
    expect(source).toContain("onPress={() => passwordRef.current?.focus()}");
    expect(source).toContain("onPress={() => confirmPasswordRef.current?.focus()}");
    expect(source).toContain("allowFontScaling={false}");
    expect(source).toContain('<StatusBar style="dark" />');
    expect(source).toContain('testID="auth-register-background-dismiss"');
    expect(source.match(/accessibilityRole="button"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("flexGrow: 1");
    expect(source).toContain('justifyContent: "center"');
    expect(source).toContain("const compactViewportCorrection = height < 900 ? -3 : 0");
    expect(source).toContain("focusedFieldKeyboardScrollCorrection");
    expect(source).toContain("password: -47");
    expect(source).toContain("confirmPassword: 0");
    expect(source).toContain(
      "(focusedField ? focusedFieldKeyboardScrollCorrection[focusedField] : 0)",
    );
    expect(source).toContain("registerTitleCorrection: { transform: [{ translateX: -1 / 3 }] }");
    expect(source).toContain("automaticallyAdjustKeyboardInsets={false}");
    expect(source).toContain("spacing={10}");
    expect(source).toContain("<AuthFormCard rowGap={13}>");
    expect(source).toContain("minHeight: 19.3333333333");
    expect(source).toContain('textShadowColor: "rgba(0,0,0,0.08)"');
    expect(source).toContain("configureAuthFocusShiftAnimation()");
    expect(source.match(/returnKeyType="next"/gu)).toHaveLength(3);
    expect(source).toContain('returnKeyType="go"');
    expect(source).toContain("onSubmitEditing={() => nicknameRef.current?.focus()}");
    expect(source).toContain("onSubmitEditing={() => passwordRef.current?.focus()}");
    expect(source).toContain("onSubmitEditing={() => confirmPasswordRef.current?.focus()}");
    expect(source).toContain("onSubmitEditing={continueToEmail}");
    expect(source.match(/textContentType="newPassword"/gu)).toHaveLength(2);
    expect(source.match(/secureTextEntry=\{!/gu)).toHaveLength(2);
    expect(source.match(/autoCapitalize="none"/gu)).toHaveLength(3);
    expect(source.match(/autoCorrect=\{false\}/gu)).toHaveLength(4);
    expect(source.indexOf("validationHint ?")).toBeLessThan(source.indexOf("error !== null ?"));
    expect(source).toContain("isLoading={isSubmitting}");
    expect(source).toContain("isEnabled={credentialsEnabled}");
    expect(source).toContain("minHeight: 44");
    expect(source).toContain("onPress={() => router.back()}");
  });
});
