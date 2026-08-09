import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const copiedNativeRoot = resolve(expoRoot, "..");

describe("Profile source parity", () => {
  it("locks every copied native source used by the screen", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/ProfileView.swift":
        "066764464729c8d75422ed48ab5fc13d5f4896036a2cf826b1bd982e4564c1a3",
      "BWChat/ViewModels/ProfileViewModel.swift":
        "126f560668b09acdb4f53132cf9ac32e777f404df3f18d19e8864df85be2bf06",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "BWChat/Services/AppRemoteConfigStore.swift":
        "6bcf0f8367120bd0fddeb6b27ca1b768fb3d92bb0182c4cdda5d04cdbe3ce85f",
      "BWChat/Services/WalletStore.swift":
        "cbc20644b9619fd707cf3372265af42e13528f5dcc2d3924455351af66b3cbe6",
      "BWChat/Services/DynamicRouteHandler.swift":
        "fba6f7c42e069901cd310940dad900f7c48a24b92b94fe6083efb7fa2abe24b2",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(native(relativePath)).digest("hex")).toBe(expected);
    }
  });

  it("keeps the profile and share-sheet geometry while omitting the nickname ID capsule", () => {
    const screen = expo("src/app/(tabs)/profile.tsx");
    for (const contract of [
      "contentGap: 14",
      "horizontalInset: 16",
      "heroVerticalInset: 18",
      "heroRadius: 18",
      "avatarFrame: 82",
      "avatarSize: 76",
      "bioLineHeight: 20",
      "bioVerticalCompensation: -1.5",
      "fontSize: 24",
      "fontSize: 22",
      "actionHeight: 42",
      "rowMinHeight: 50",
      "iconSize: 40",
      "dividerHeight: 21",
      "dividerLineHeight: 1",
      "dividerLeadingInset: 55",
      'maxHeight: "78%"',
      "size={172}",
      'ecl="M"',
      "height: 50",
    ]) {
      expect(screen).toContain(contract);
    }
    expect(screen).toContain('<View pointerEvents="none" style={styles.heroOutline} />');
    expect(screen).toContain('<View pointerEvents="none" style={styles.groupedCardOutline} />');
    expect(screen).toContain("borderColor: `${theme.separator}B3`");
    expect(screen).toContain("<View style={styles.dividerLine} />");
    expect(screen).not.toContain("marginTop: 10");
    const hero = screen.slice(
      screen.indexOf("function ProfileHero"),
      screen.indexOf("function ProfileStat"),
    );
    expect(hero).not.toContain("styles.idCapsule");
    expect(hero).not.toContain("styles.idText");
    expect(hero).not.toContain("`ID: ${userId}`");
  });

  it("keeps strict profile/wallet API calls and the original lifecycle refreshes", () => {
    const api = expo("src/api/bwchat.ts");
    const screen = expo("src/app/(tabs)/profile.tsx");
    expect(api).toContain('apiRequest<unknown>("/profile/me", {');
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
    expect(api).toContain("return (await getWalletBalance()).gold_coin_balance");
    expect(api).toContain('apiRequest<unknown>("/wallet/balance"');
    expect(screen).toContain('AppState.addEventListener("change"');
    expect(screen).toContain("void refreshConfig()");
    expect(screen).toContain("void load()");
    expect(screen).toContain("Promise.allSettled");
    expect(screen).toContain("profileLoadCanCommit");
    expect(screen).toContain("profileResponseBelongsToOwner");
    expect(screen).toContain("await updateUser(profileResult.value)");
  });

  it("uses the complete dynamic route handler, localized copy, toast, and account-scoped state", () => {
    const screen = expo("src/app/(tabs)/profile.tsx");
    const routes = expo("src/services/web/DynamicRouteNavigator.ts");
    expect(screen).toContain("openDynamicRoute(");
    expect(screen).toContain("config.webViewPolicy");
    expect(screen).toContain("profileMenuTitle(item, activeLanguage, t)");
    expect(screen).toContain("profileMenuSubtitle(item, activeLanguage, t)");
    expect(screen).toContain('t("profile.wallet.balance", walletBalance)');
    expect(screen).toContain('t("profile.more.linkCopied")');
    expect(screen).toContain("<TopToast");
    expect(screen).toContain("walletSnapshot?.ownerId === ownerId");
    expect(screen).toContain("errorSnapshot?.ownerId === ownerId");
    expect(routes).toContain('prop_bag: "/prop-bag" as Href');
    for (const staleLiteral of [
      'title="帖子"',
      'title="粉丝"',
      'title="关注"',
      'title="编辑资料"',
      'title="分享主页"',
      'title: "设置"',
      '"加载中…"',
      '"点击查看"',
      'Alert.alert("已复制"',
    ]) {
      expect(screen).not.toContain(staleLiteral);
    }
  });

  it("keeps VoiceOver roles and dynamic light/dark system surfaces", () => {
    const screen = expo("src/app/(tabs)/profile.tsx");
    expect(screen).toContain('accessibilityRole="header"');
    expect(screen).toContain('accessibilityRole="button"');
    expect(screen).toContain("palette(useColorScheme())");
    expect(screen).toContain("backgroundColor: theme.background");
    expect(screen).toContain("backgroundColor: theme.card");
    expect(screen).toContain("color: theme.text");
    expect(screen).toContain("color: theme.secondaryText");
  });
});

function expo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function native(relativePath: string): Buffer {
  return readFileSync(resolve(copiedNativeRoot, relativePath));
}
