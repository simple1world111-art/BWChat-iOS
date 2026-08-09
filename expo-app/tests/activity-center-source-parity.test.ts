import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(__dirname, "..");

describe("ActivityCenter source and asset parity guards", () => {
  it("uses every ActivityCenter image as an original byte-preserved asset and the real product route", () => {
    const assets = fs.readFileSync(path.join(root, "src/assets/nativeAssets.ts"), "utf8");
    const page = fs.readFileSync(path.join(root, "src/app/activity-center.tsx"), "utf8");
    const discover = fs.readFileSync(path.join(root, "src/app/(tabs)/discover.tsx"), "utf8");
    expect(assets).toContain("activity_cat_food_icon.imageset/activity_cat_food_icon.png");
    expect(assets).toContain("activity_claim_burst.imageset/activity_claim_burst.png");
    expect(assets).toContain("activity_reward_paw.imageset/activity_reward_paw.png");
    expect(assets).toContain("wallet_gold_coin_badge.imageset/wallet_gold_coin_badge.png");
    expect(page).toContain("nativeAssets.activityClaimBurst");
    expect(page).toContain("nativeAssets.activityRewardPaw");
    expect(page).toContain("nativeAssets.walletGoldCoinBadge");
    expect(discover).toContain('router.push("/activity-center" as Href)');
    const assetHashes = {
      "activity_cat_food_icon.imageset/activity_cat_food_icon.png":
        "81b1daf6fa1813afdd00dfa1ab9bf801c6ff703c5f5f2f1a5116677a938dbfe6",
      "activity_claim_burst.imageset/activity_claim_burst.png":
        "b3e47c0954558aa797118c1265655a1f1cd9de70ae78a844a946ccdd1ec7cf5e",
      "activity_reward_paw.imageset/activity_reward_paw.png":
        "e861f42b861d14784c856a0256f684e0637d4cf5a00f06823f2c1479edd30422",
      "wallet_gold_coin_badge.imageset/wallet_gold_coin_badge.png":
        "8685a0a49e36af5d3bd426d21a3b983b2929d5dc0ffcb3333d4b3b46e1b776b2",
    };
    for (const [asset, expectedHash] of Object.entries(assetHashes)) {
      const bytes = fs.readFileSync(
        path.join(root, "assets/native-original/Assets.xcassets", asset),
      );
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedHash);
    }
  });

  it("locks the native wheel motion and reward animation durations in source", () => {
    const page = fs.readFileSync(path.join(root, "src/app/activity-center.tsx"), "utf8");
    const models = fs.readFileSync(
      path.join(root, "src/services/activity/ActivityModels.ts"),
      "utf8",
    );
    expect(page).toContain("activityWheelLandingRotation(rotation.value, index, 6)");
    expect(page).toContain("easing: activityWheelLandingProgress");
    expect(models).toMatch(
      /function activityWheelLandingProgress\([^)]*\)[^{]*\{\s*["']worklet["'];/u,
    );
    expect(page).toContain("duration: 4_000");
    expect(page).toContain("await delay(4_000)");
    expect(page).toContain("await delay(260)");
    expect(page).toContain("const finish = setTimeout(() => onFinishedRef.current(), 1_070)");
    expect(page).toContain("const finish = setTimeout(() => onFinishedRef.current(), 900)");
    expect(page).toContain("burstRotation.value = withTiming(24, { duration: 580 })");
    expect(page).toContain("rewardOffset.value = withTiming(-31, { duration: 200 })");
    expect(page).toContain("useReduceMotionPreference()");
    expect(page).toContain("animated: !reduceMotion");
  });

  it("keeps every sensitive/native capability behind the same contract", () => {
    const repository = fs.readFileSync(
      path.join(root, "src/services/activity/ActivityCenterRepository.ts"),
      "utf8",
    );
    const page = fs.readFileSync(path.join(root, "src/app/activity-center.tsx"), "utf8");
    expect(repository).toContain("expo-contacts/legacy");
    expect(repository).toContain("libphonenumber-js/max");
    expect(repository).toContain("`${salt}\\u0000${e164}`");
    expect(repository).toContain("phone_hashes: [...phoneHashes]");
    expect(repository).toContain('{ "Cache-Control": "no-store" }');
    expect(repository).toContain('cache: "no-store"');
    expect(repository).toContain("transientRetries: false");
    expect(repository).not.toContain("contact.name");
    expect(page).toContain("accessibilityState={{ busy: loading, disabled: unavailable }}");
    expect(page).not.toContain("allowFontScaling={false}");
    expect(page.match(/\bautoFocus\b/g)).toHaveLength(2);
    expect(page).toMatch(/accessibilityActions=\{\[\{ name: "addFriend"/);
    expect(page).toContain("requestFriend(false)");
  });

  it("destroys native-equivalent modal state after each dismissal", () => {
    const page = fs.readFileSync(path.join(root, "src/app/activity-center.tsx"), "utf8");
    expect(page).toContain("{phoneVisible ? (");
    expect(page).toContain("{matchesVisible ? (");
    expect(page).toContain("{redeemVisible ? (");
    expect(page).toContain("{wheelResult ? (");
  });

  it("consumes each invite-link delivery once while allowing the same token to be reopened", () => {
    const handler = fs.readFileSync(
      path.join(root, "src/components/ActivityInviteLinkHandler.tsx"),
      "utf8",
    );
    const page = fs.readFileSync(path.join(root, "src/app/activity-center.tsx"), "utf8");
    expect(handler).toContain("deliverySequenceRef");
    expect(handler).toContain("inviteDelivery: delivery.id");
    expect(handler).not.toContain("routedRef");
    expect(page).toContain("redeemedDeliveryRef");
    expect(page).toContain("params.inviteDelivery");
  });

  it("destroys account-sensitive presentation state and generations on owner changes", () => {
    const page = fs.readFileSync(path.join(root, "src/app/activity-center.tsx"), "utf8");
    const store = fs.readFileSync(
      path.join(root, "src/services/activity/useActivityCenter.ts"),
      "utf8",
    );
    expect(page).toContain("presentedOwnerRef");
    expect(page).toContain("setPhoneVisible(false)");
    expect(page).toContain("setMatchesVisible(false)");
    expect(page).toContain("setRedeemVisible(false)");
    expect(page).toContain("setWheelResult(undefined)");
    expect(page).toContain('key={`activity-wheel-${user?.user_id?.trim() || "anonymous"}`}');
    expect(page).toContain("spinSequenceRef");
    expect(page).toContain("!mountedRef.current || spinSequenceRef.current !== sequence");
    expect(store).toContain("generationRef");
    expect(store).toContain("tokenSequenceRef");
    expect(store).toContain("isCurrentOperation");
    expect(store).toContain("shareSessionAuthoritiesRef");
    expect(store).toContain("phoneSessionAuthorityRef");
    expect(store).not.toContain("queueMicrotask");
  });

  it("keeps native error acknowledgement and modal accessibility isolation", () => {
    const page = fs.readFileSync(path.join(root, "src/app/activity-center.tsx"), "utf8");
    expect(page).toContain('{ text: t("common.ok"), style: "cancel" }');
    expect(page.match(/accessibilityViewIsModal/g)).toHaveLength(4);
  });

  it("keeps the minimal native back button and a native-equivalent DEBUG preview route", () => {
    const page = fs.readFileSync(path.join(root, "src/app/activity-center.tsx"), "utf8");
    const preview = fs.readFileSync(
      path.join(root, "src/services/activity/ActivityCenterPreviewSupport.ts"),
      "utf8",
    );
    expect(page).toContain('headerBackButtonDisplayMode: "minimal"');
    expect(page).toContain("__DEV__ && isActivityPreviewVariant");
    expect(page).toContain("activityCenterPreviewSnapshot");
    expect(preview).toContain('configVersion: "activity-preview-v1"');
    expect(preview).toContain('inviteCode: "MEOW88"');
    expect(preview).toContain('spinID: "wheel-result-preview"');
  });
});
