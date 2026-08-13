import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { WalletEmptyState, WalletTransactionRow } from "@/components/wallet/WalletRecords";

jest.mock("expo-image", () => {
  const { View } = jest.requireActual("react-native");
  return { Image: (props: object) => <View {...props} /> };
});

jest.mock("expo-symbols", () => ({ SymbolView: () => null }));

jest.mock("@/assets/nativeAssets", () => ({
  nativeAssets: { walletEmptyCat: 1, walletGoldCoinBadge: 2 },
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string, ...args: (string | number)[]) => [key, ...args].join("|"),
  }),
}));

describe("wallet VoiceOver, dynamic type, and dark appearance contracts", () => {
  test("keeps explicit semantics for every interactive main-wallet control", () => {
    const source = readFileSync(`${process.cwd()}/src/app/wallet.tsx`, "utf8");

    expect(source).toContain('accessibilityRole="header"');
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain('accessibilityRole="link"');
    expect(source).toContain("accessibilityState={{ checked: agreed }}");
    expect(source).toContain('pathname: "/dynamic-screen/[id]"');
    expect(source).toContain("params: { id: runtime.termsScreenId }");
    const toastSource = readFileSync(`${process.cwd()}/src/components/TopToast.tsx`, "utf8");
    expect(toastSource).toContain('accessibilityLiveRegion="assertive"');
    expect(source).toContain("busy: purchase.isPurchasing || purchase.isLoadingProducts");
    const recordsSource = readFileSync(
      `${process.cwd()}/src/components/wallet/WalletRecords.tsx`,
      "utf8",
    );
    expect(recordsSource).toContain("const colorScheme = useColorScheme()");
    expect(recordsSource).toContain('colorScheme === "dark" ? "#000000" : "#FFFFFF"');
  });

  test("does not disable Dynamic Type font scaling in wallet surfaces", () => {
    const files = [
      "src/app/wallet.tsx",
      "src/app/wallet-transactions.tsx",
      "src/components/wallet/WalletRecords.tsx",
    ];
    for (const file of files) {
      expect(readFileSync(`${process.cwd()}/${file}`, "utf8")).not.toContain(
        "allowFontScaling={false}",
      );
    }
  });

  test("groups transaction content into one complete VoiceOver announcement", async () => {
    await render(
      <WalletTransactionRow
        transaction={{
          id: "income",
          type: "ios_iap",
          currency: "gold_coin",
          gold_coin_amount: 100,
          created_at: "2026-08-07T01:02:03Z",
        }}
      />,
    );

    const row = screen.getByLabelText(
      /wallet\.transaction\.iap.*\+100 wallet\.currency\.goldCoins/u,
    );
    expect(row.props.accessibilityRole).toBe("text");
    expect(["#000000", "#FFFFFF"]).toContain(StyleSheet.flatten(row.props.style).backgroundColor);
  });

  test("exposes empty wallet content semantics", async () => {
    await render(<WalletEmptyState subtitle="offline" title="empty" />);
    expect(screen.getByLabelText("empty, offline")).toBeTruthy();
  });
});
