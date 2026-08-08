import { render } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LoadingState } from "@/components/States";

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => (key === "common.loading" ? "正在加载" : key) }),
}));

describe("native LoadingView parity", () => {
  it("uses the localized native default message", async () => {
    const view = await render(<LoadingState />);
    expect(view.getByText("正在加载")).toBeTruthy();
    await view.unmount();
  });

  it("preserves a caller supplied loading message", async () => {
    const view = await render(<LoadingState label="同步消息" />);
    expect(view.getByText("同步消息")).toBeTruthy();
    await view.unmount();
  });

  it("preserves 12pt spacing, caption text and 80% full-screen background", () => {
    const root = resolve(__dirname, "..");
    const native = readFileSync(resolve(root, "../BWChat/Components/LoadingView.swift"), "utf8");
    const expo = readFileSync(resolve(root, "src/components/States.tsx"), "utf8");
    expect(native).toContain("VStack(spacing: 12)");
    expect(native).toContain(".font(.caption)");
    expect(native).toContain("AppColors.background.opacity(0.8)");
    expect(expo).toContain("rowGap: 12");
    expect(expo).toContain("fontSize: 12");
    expect(expo).toContain("withAlpha(theme.background, 0.8)");
  });
});
