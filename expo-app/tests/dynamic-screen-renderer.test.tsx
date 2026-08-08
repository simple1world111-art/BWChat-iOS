import { fireEvent, render, waitFor } from "@testing-library/react-native";

import {
  DynamicComponentRenderer,
  dynamicIconGradient,
} from "@/components/dynamic-screen/DynamicComponentRenderer";
import type { DynamicComponent } from "@/services/dynamic-screen/DynamicScreenModels";

const mockRefreshBalance = jest.fn(async () => undefined);

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    LinearGradient: ({ children, ...props }: { children: React.ReactNode }) => (
      <MockView {...props}>{children}</MockView>
    ),
  };
});

jest.mock("@/components/dynamic-screen/DynamicRemoteAssetImage", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    DynamicRemoteAssetImage: ({ assetKey }: { assetKey?: string }) => (
      <MockText>{assetKey ?? "fallback-image"}</MockText>
    ),
  };
});

jest.mock("@/components/messages/ChatGiftViews", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { GiftAssetIcon: ({ assetKey }: { assetKey: string }) => <MockText>{assetKey}</MockText> };
});

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "zh-Hans",
    t: (key: string) =>
      ({
        "wallet.balance": "金币余额",
        "common.loading": "加载中",
        "gift.item.fish": "小鱼干",
        "gift.item.wand": "逗猫棒",
        "gift.item.yarn": "毛线球",
        "gift.item.can": "猫罐头",
      })[key] ?? key,
  }),
}));

jest.mock("@/providers/WalletProvider", () => ({
  useWallet: () => ({ balance: { gold_coin_balance: 88 }, refreshBalance: mockRefreshBalance }),
}));

describe("dynamic component renderer interactions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders localized rows, icon colors and dispatches the original route", async () => {
    const onRoute = jest.fn();
    const action = { type: "screen", screenId: "daily_rewards" };
    const view = await render(
      <DynamicComponentRenderer
        component={component(
          "action",
          "actionRow",
          {
            title: { "zh-Hans": "领取每日奖励", en: "Claim" },
            subtitle: "今天可领取",
            system_image: "gift.fill",
            colors: ["FF9500", "FFCC00"],
          },
          action,
        )}
        onRoute={onRoute}
      />,
    );
    fireEvent.press(view.getByText("领取每日奖励"));
    expect(view.getByText("今天可领取")).toBeTruthy();
    expect(view.getByText("gift.fill")).toBeTruthy();
    expect(view.getByRole("button")).toBeTruthy();
    expect(onRoute).toHaveBeenCalledWith(action);
  });

  it("does not dispatch a banner without an action", async () => {
    const onRoute = jest.fn();
    const view = await render(
      <DynamicComponentRenderer
        component={component("hero", "banner", { title: "只展示" })}
        onRoute={onRoute}
      />,
    );
    fireEvent.press(view.getByText("只展示"));
    expect(view.getByRole("button")).toBeDisabled();
    expect(onRoute).not.toHaveBeenCalled();
  });

  it("filters invisible nested children and ignores unsupported component types", async () => {
    const card = component("card", "card", {}, undefined, [
      component("shown", "text", { text: "显示" }),
      { ...component("hidden", "text", { text: "隐藏" }), visible: false },
      component("unknown", "future_component", { text: "未知" }),
    ]);
    const view = await render(<DynamicComponentRenderer component={card} onRoute={jest.fn()} />);
    expect(view.getByText("显示")).toBeTruthy();
    expect(view.queryByText("隐藏")).toBeNull();
    expect(view.queryByText("未知")).toBeNull();
  });

  it("refreshes the wallet balance and opens the wallet fallback route", async () => {
    const onRoute = jest.fn();
    const view = await render(
      <DynamicComponentRenderer
        component={component("wallet", "wallet_balance", {})}
        onRoute={onRoute}
      />,
    );
    await waitFor(() => expect(mockRefreshBalance).toHaveBeenCalledTimes(1));
    expect(view.getByText("88")).toBeTruthy();
    fireEvent.press(view.getByText("金币余额"));
    expect(onRoute).toHaveBeenCalledWith({ type: "native", name: "wallet" });
  });

  it("renders the original first four fixed gifts", async () => {
    const view = await render(
      <DynamicComponentRenderer
        component={component("gifts", "giftPreview", {})}
        onRoute={jest.fn()}
      />,
    );
    for (const asset of ["gift_fish", "gift_wand", "gift_yarn", "gift_can"])
      expect(view.getByText(asset)).toBeTruthy();
  });

  it("preserves Swift AARRGGBB color semantics and hex trimming", () => {
    expect(dynamicIconGradient(["#80FF0000", " E9F8FF "], "#667EEA")).toEqual([
      "#FF000080",
      "#E9F8FF",
    ]);
    expect(dynamicIconGradient(["not-a-color"], "#667EEA")).toEqual(["#667EEA", "#667EEA"]);
  });
});

function component(
  id: string,
  type: string,
  props: DynamicComponent["props"],
  action?: DynamicComponent["action"],
  children?: DynamicComponent[],
): DynamicComponent {
  return { id, type, props, ...(action ? { action } : {}), ...(children ? { children } : {}) };
}
