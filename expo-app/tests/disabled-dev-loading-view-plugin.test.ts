// The config plugin is intentionally CommonJS because Expo loads it directly from app.config.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { injectDisabledDevLoadingView } = require("../plugins/with-disabled-dev-loading-view");

describe("Development Client loading banner config plugin", () => {
  const appDelegate = `import Expo\nimport React\n\nclass AppDelegate {\n  func application() {\n    let delegate = ReactNativeDelegate()\n  }\n}`;

  it("disables the native loading view before React Native is initialized", () => {
    const result = injectDisabledDevLoadingView(appDelegate);

    expect(result).toContain("#if DEBUG");
    expect(result).toContain("RCTDevLoadingViewSetEnabled(false)");
    expect(result.indexOf("RCTDevLoadingViewSetEnabled(false)")).toBeLessThan(
      result.indexOf("let delegate = ReactNativeDelegate()"),
    );
  });

  it("is idempotent across repeated Expo prebuilds", () => {
    const once = injectDisabledDevLoadingView(appDelegate);
    const twice = injectDisabledDevLoadingView(once);

    expect(twice).toBe(once);
    expect(twice.match(/RCTDevLoadingViewSetEnabled\(false\)/g)).toHaveLength(1);
  });

  it("fails loudly if Expo changes the AppDelegate template", () => {
    expect(() => injectDisabledDevLoadingView("class AppDelegate {}")).toThrow(
      "Unable to locate the ReactNativeDelegate initialization",
    );
  });
});
