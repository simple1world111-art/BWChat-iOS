import { render } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CenterToast, TopToast } from "@/components/TopToast";

describe("native ToastView parity", () => {
  it("renders the top toast as a non-interactive alert", async () => {
    const view = await render(<TopToast message="顶部提示" onDismiss={jest.fn()} />);
    const message = view.getByText("顶部提示");
    expect(message.parent?.props.accessibilityRole).toBe("alert");
    expect(message.parent?.props.pointerEvents).toBe("none");
    await view.unmount();
  });

  it("renders the distinct center toast contract", async () => {
    const view = await render(<CenterToast message="居中提示" onDismiss={jest.fn()} />);
    const message = view.getByText("居中提示");
    expect(message.parent?.props.accessibilityRole).toBe("alert");
    expect(message.parent?.props.pointerEvents).toBe("none");
    await view.unmount();
  });

  it("preserves both native geometries, transition types and full-duration timer", () => {
    const root = resolve(__dirname, "..");
    const native = readFileSync(resolve(root, "../BWChat/Components/ToastView.swift"), "utf8");
    const expo = readFileSync(resolve(root, "src/components/TopToast.tsx"), "utf8");
    expect(native).toContain("Color.black.opacity(0.75)");
    expect(native).toContain("Color.black.opacity(0.78)");
    expect(native).toContain(".transition(.move(edge: .top).combined(with: .opacity))");
    expect(native).toContain(".transition(.scale(scale: 0.94).combined(with: .opacity))");
    expect(expo).toContain('backgroundColor: "rgba(0,0,0,0.75)"');
    expect(expo).toContain('backgroundColor: "rgba(0,0,0,0.78)"');
    expect(expo).toContain("outputRange: [-(toastHeight + 8), 0]");
    expect(expo).toContain("outputRange: [0.94, 1]");
    expect(expo).toContain("Math.max(0, duration)");
    expect(expo).not.toContain("duration - 200");
  });

  it("routes Wallet's native top and center modifiers through both shared variants", () => {
    const wallet = readFileSync(resolve(__dirname, "../src/app/wallet.tsx"), "utf8");
    expect(wallet).toContain("<TopToast");
    expect(wallet).toContain("<CenterToast");
    expect(wallet).toContain("topInset={insets.top}");
  });

  it("restores both four-second app-root call error toasts", () => {
    const root = resolve(__dirname, "..");
    const callProvider = readFileSync(resolve(root, "src/providers/CallProvider.tsx"), "utf8");
    const liveCallProvider = readFileSync(
      resolve(root, "src/providers/LiveCallProvider.tsx"),
      "utf8",
    );
    expect(callProvider).toContain("<TopToast");
    expect(callProvider).toContain("duration={4_000}");
    expect(callProvider).toContain("showError: setErrorToast");
    expect(liveCallProvider).toContain("<TopToast duration={4_000}");
  });
});
