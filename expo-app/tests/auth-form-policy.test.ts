import { APIError } from "@/api/client";
import {
  acquireAuthSubmission,
  isBlank,
  isLoginFormEnabled,
  isRegisterFormEnabled,
  localizedLoginError,
  localizedRegisterError,
  registerValidationHint,
  releaseAuthSubmission,
} from "@/services/auth/authFormPolicy";

const t = (key: string) => `localized:${key}`;

describe("native auth form policy parity", () => {
  it("synchronously rejects a second auth submission until the first one releases", () => {
    const lock = { current: false };
    expect(acquireAuthSubmission(lock)).toBe(true);
    expect(acquireAuthSubmission(lock)).toBe(false);
    releaseAuthSubmission(lock);
    expect(acquireAuthSubmission(lock)).toBe(true);
  });

  it("treats whitespace-only values as blank without trimming submitted values", () => {
    expect(isBlank(" \n\t ")).toBe(true);
    expect(isBlank("\u0085\u200B")).toBe(true);
    expect(isBlank("\uFEFF")).toBe(false);
    expect(isBlank(" a ")).toBe(false);
    expect(isLoginFormEnabled(" user ", " secret ", false)).toBe(true);
    expect(isLoginFormEnabled("user", "      ", false)).toBe(false);
    expect(isLoginFormEnabled("user", "secret", true)).toBe(false);
  });

  it("matches the native register enablement and validation order", () => {
    expect(isRegisterFormEnabled(" ab", "secret", "secret", false)).toBe(true);
    // AuthViewModel uses `password.count >= 6` here rather than
    // `!password.isBlank`, so preserve this exact source-level edge.
    expect(isRegisterFormEnabled("abc", "      ", "      ", false)).toBe(true);
    expect(isRegisterFormEnabled("abc", "secret", "different", false)).toBe(false);
    expect(registerValidationHint(" ", "", "", t)).toBeNull();
    expect(registerValidationHint("ab", "", "", t)).toBe(
      "localized:auth.validation.usernameTooShort",
    );
    expect(registerValidationHint("abc", "123", "", t)).toBe(
      "localized:auth.validation.passwordTooShort",
    );
    expect(registerValidationHint("abc", "secret", "other", t)).toBe(
      "localized:auth.validation.passwordMismatch",
    );
  });

  it("counts Swift-style extended grapheme clusters for register length rules", () => {
    const family = "👨‍👩‍👧‍👦";
    expect(isRegisterFormEnabled(`${family}a`, "secret", "secret", false)).toBe(false);
    expect(registerValidationHint(`${family}a`, "", "", t)).toBe(
      "localized:auth.validation.usernameTooShort",
    );
    expect(isRegisterFormEnabled("abc", `${family}1234`, `${family}1234`, false)).toBe(false);
    expect(registerValidationHint("abc", `${family}1234`, "", t)).toBe(
      "localized:auth.validation.passwordTooShort",
    );
    expect(isRegisterFormEnabled("abc", `${family}12345`, `${family}12345`, false)).toBe(true);
  });

  it("localizes invalid credentials and non-API fallbacks like AuthViewModel", () => {
    expect(localizedLoginError(new APIError("anything", 401), t)).toBe(
      "localized:auth.login.invalidCredentials",
    );
    expect(localizedLoginError(new APIError("invalid_credentials", 422), t)).toBe(
      "localized:auth.login.invalidCredentials",
    );
    expect(localizedLoginError(new APIError("\u200BINVALID_CREDENTIALS\u0085", 422), t)).toBe(
      "localized:auth.login.invalidCredentials",
    );
    expect(localizedLoginError(new APIError("server detail", 422), t)).toBe("server detail");
    expect(localizedLoginError(new APIError(" server detail ", 422), t)).toBe(" server detail ");
    expect(localizedLoginError(new APIError("", 422), t)).toBe("");
    expect(
      localizedLoginError(
        new APIError("api.invalidResponse", 200, { code: 0, message: " \u200B", data: null }, 0),
        t,
      ),
    ).toBe("localized:api.invalidResponse");
    expect(localizedLoginError(new Error("raw JS error"), t)).toBe("localized:auth.login.failed");
    expect(localizedRegisterError(new APIError("server detail", 422), t)).toBe("server detail");
    expect(localizedRegisterError(new APIError(" server detail ", 422), t)).toBe(" server detail ");
    expect(localizedRegisterError(new APIError("", 422), t)).toBe("");
    expect(localizedRegisterError(new Error("raw JS error"), t)).toBe(
      "localized:auth.register.failed",
    );
  });

  it("maps native auth error categories through every active language catalog", () => {
    expect(localizedLoginError(new APIError("offline detail", 0), t)).toBe(
      "localized:api.networkUnavailable",
    );
    expect(localizedLoginError(new APIError("invalid_credentials", 0), t)).toBe(
      "localized:api.networkUnavailable",
    );
    expect(localizedLoginError(new APIError("timeout", 408), t)).toBe(
      "localized:api.networkUnavailable",
    );
    expect(localizedLoginError(new APIError("gateway detail", 503), t)).toBe("gateway detail");
    expect(localizedLoginError(new APIError("api.serverUnavailable", 503), t)).toBe(
      "api.serverUnavailable",
    );
    expect(
      localizedLoginError(
        new APIError("localized fallback", 503, { message: " upstream detail " }),
        t,
      ),
    ).toBe("upstream detail");
    expect(
      localizedLoginError(new APIError("generic", 422, { detail: { message: "field detail" } }), t),
    ).toBe("field detail");
    expect(localizedRegisterError(new APIError("gateway detail", 503), t)).toBe(
      "localized:api.serverUnavailable",
    );
    expect(localizedRegisterError(new APIError("api.someServerDetail", 503), t)).toBe(
      "localized:api.serverUnavailable",
    );
    expect(localizedRegisterError(new APIError("wrapped gateway", 400, { code: "503" }), t)).toBe(
      "localized:api.serverUnavailable",
    );
    expect(
      localizedRegisterError(
        new APIError("  revision conflict  ", 200, {
          code: 6002,
          message: "  revision conflict  ",
          data: null,
        }),
        t,
      ),
    ).toBe("  revision conflict  ");
    expect(
      localizedRegisterError(
        new APIError("business conflict", 422, { code: 6002, message: "business conflict" }),
        t,
      ),
    ).toBe("business conflict");
    expect(
      localizedRegisterError(
        new APIError("generic fallback", 503, {
          code: "username_taken",
          message: "  username already exists  ",
        }),
        t,
      ),
    ).toBe("username already exists");
    expect(
      localizedRegisterError(
        new APIError("generic fallback", 422, { code: "username_taken", message: " \u200B" }),
        t,
      ),
    ).toBe("localized:api.invalidResponse");
    expect(
      localizedRegisterError(
        new APIError("generic fallback", 400, { code: " 503 ", message: " spaced code " }),
        t,
      ),
    ).toBe("spaced code");
    expect(
      localizedRegisterError(
        new APIError("generic fallback", 422, {
          data: { error_code: "insufficient_gold_coins" },
        }),
        t,
      ),
    ).toBe("localized:wallet.error.insufficientGoldCoins");
    expect(
      localizedRegisterError(
        new APIError("api.decodingError", 200, undefined, "decoding_error"),
        t,
      ),
    ).toBe("localized:api.decodingError");
    expect(localizedRegisterError(new APIError("unauthorized", 401), t)).toBe(
      "localized:api.unauthorized",
    );
  });
});
