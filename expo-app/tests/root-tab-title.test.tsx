import { render } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { RootTabTitle } from "@/components/RootTabTitle";

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => (key === "tab.messages" ? "消息译文" : key) }),
}));

describe("native RootTabTitle parity", () => {
  it("resolves a localization key and exposes the native header trait", async () => {
    const view = await render(<RootTabTitle localizedKey="tab.messages" />);
    expect(view.getByRole("header").props.children).toBe("消息译文");
    await view.unmount();
  });

  it("preserves a literal title source", async () => {
    const view = await render(<RootTabTitle title="固定标题" />);
    expect(view.getByRole("header").props.children).toBe("固定标题");
    await view.unmount();
  });

  it("preserves the native typography, inset, height and scale contract", () => {
    const root = resolve(__dirname, "..");
    const native = readFileSync(resolve(root, "../BWChat/Components/RootTabTitle.swift"), "utf8");
    const expo = readFileSync(resolve(root, "src/components/RootTabTitle.tsx"), "utf8");
    expect(native).toContain("size: 22, weight: .semibold");
    expect(native).toContain("minimumScaleFactor(0.78)");
    expect(native).toContain("leadingContentInset: CGFloat = 8");
    expect(native).toContain("minHeight: 28");
    expect(expo).toContain("fontSize: 22");
    expect(expo).toContain('fontWeight: "600"');
    expect(expo).toContain("minimumFontScale={0.78}");
    expect(expo).toContain("paddingLeft: 8");
    expect(expo).toContain("minHeight: 28");
  });

  it("routes all five native root screens through the shared localized title", () => {
    const root = resolve(__dirname, "..");
    const expectations = [
      ["src/app/(tabs)/conversations.tsx", "tab.messages"],
      ["src/app/(tabs)/contacts.tsx", "tab.contacts"],
      ["src/app/(tabs)/discover.tsx", "tab.discover"],
      ["src/app/(tabs)/test.tsx", "tab.test"],
      ["src/app/(tabs)/profile.tsx", "tab.profile"],
    ] as const;
    for (const [relativePath, key] of expectations) {
      const source = readFileSync(resolve(root, relativePath), "utf8");
      expect(source).toContain(`<RootTabTitle localizedKey="${key}"`);
    }
  });
});
