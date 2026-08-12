import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

import { DynamicRemoteAssetImage } from "@/components/dynamic-screen/DynamicRemoteAssetImage";
import { GiftAssetIcon } from "@/components/messages/ChatGiftViews";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  dynamicArray,
  dynamicInteger,
  dynamicString,
  localizedDynamicProp,
  normalizeDynamicToken,
  type DynamicComponent,
} from "@/services/dynamic-screen/DynamicScreenModels";
import {
  dynamicScreenBannerGradient,
  dynamicScreenPalette,
  dynamicScreenVisualPolicy as metrics,
} from "@/services/dynamic-screen/DynamicScreenVisualPolicy";
import { fixedGiftCatalog, localizedGiftCatalogName } from "@/services/messages/chatGiftPolicy";
import type { DynamicRoute } from "@/services/remote-config/types";
import { colors } from "@/theme";

export function DynamicComponentRenderer({
  component,
  onRoute,
}: {
  component: DynamicComponent;
  onRoute: (route?: DynamicRoute | undefined) => void;
}) {
  const { activeLanguage, t } = useLocalization();
  const theme = dynamicScreenPalette(useColorScheme());
  const token = normalizeDynamicToken(component.type);
  const title =
    localizedDynamicProp(component.props, "title", activeLanguage) ??
    localizedDynamicProp(component.props, "text", activeLanguage) ??
    (dynamicString(component.props.title_key)
      ? t(dynamicString(component.props.title_key) as string)
      : undefined) ??
    component.id;
  const subtitle =
    localizedDynamicProp(component.props, "subtitle", activeLanguage) ??
    (dynamicString(component.props.subtitle_key)
      ? t(dynamicString(component.props.subtitle_key) as string)
      : undefined);
  const systemImage = dynamicString(component.props.system_image);
  const children = component.children?.filter((child) => child.visible ?? true) ?? [];
  const childStack = (
    <View style={styles.childStack}>
      {children.map((child) => (
        <DynamicComponentRenderer component={child} key={child.id} onRoute={onRoute} />
      ))}
    </View>
  );

  if (["screen", "section", "list"].includes(token)) return childStack;
  if (token === "card")
    return <View style={[styles.card, { backgroundColor: theme.card }]}>{childStack}</View>;
  if (["row", "actionrow", "action_row"].includes(token)) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => onRoute(component.action)}
        style={styles.row}
      >
        <DynamicIcon component={component} fallback="sparkles" size={metrics.rowIconSize} />
        <View style={styles.rowCopy}>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            numberOfLines={1}
            style={[styles.rowTitle, { color: theme.text }]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              numberOfLines={1}
              style={[styles.rowSubtitle, { color: theme.secondaryText }]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <SymbolView
          name="chevron.right"
          size={13}
          weight="semibold"
          tintColor={theme.tertiaryText}
        />
      </Pressable>
    );
  }
  if (token === "banner") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !component.action }}
        disabled={!component.action}
        onPress={() => onRoute(component.action)}
      >
        <LinearGradient
          colors={dynamicScreenBannerGradient}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={styles.banner}
        >
          <DynamicIcon component={component} fallback="sparkles" size={metrics.bannerIconSize} />
          <View style={styles.bannerCopy}>
            <Text numberOfLines={2} style={[styles.bannerTitle, { color: theme.text }]}>
              {title}
            </Text>
            {subtitle ? (
              <Text
                numberOfLines={3}
                style={[styles.bannerSubtitle, { color: theme.secondaryText }]}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </LinearGradient>
      </Pressable>
    );
  }
  if (token === "text") {
    const textStyle = normalizeDynamicToken(dynamicString(component.props.style) ?? "");
    const isTitle = textStyle === "title";
    if (textStyle === "legal_body") {
      return (
        <View style={[styles.legalDocumentCard, { backgroundColor: theme.card }]}>
          <Text selectable style={[styles.legalDocumentBody, { color: theme.text }]}>
            {title}
          </Text>
        </View>
      );
    }
    return (
      <Text
        style={[
          isTitle ? styles.titleText : styles.bodyText,
          { color: isTitle ? theme.text : theme.secondaryText },
        ]}
      >
        {title}
      </Text>
    );
  }
  if (token === "image") {
    return (
      <View
        style={[
          styles.image,
          {
            backgroundColor: theme.card,
            height: dynamicInteger(component.props.height) ?? metrics.imageDefaultHeight,
          },
        ]}
      >
        <DynamicRemoteAssetImage
          assetKey={
            dynamicString(component.props.asset_key) ??
            dynamicString(component.props.remote_asset_key)
          }
          fallbackAssetName={dynamicString(component.props.fallback_asset_name)}
          fallbackSystemImage={systemImage ?? "photo"}
        />
      </View>
    );
  }
  if (token === "button") {
    return (
      <Pressable accessibilityRole="button" onPress={() => onRoute(component.action)}>
        <LinearGradient
          colors={[theme.accent, theme.accentDark]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={styles.button}
        >
          {systemImage ? (
            <SymbolView
              name={systemImage as SFSymbol}
              size={14}
              weight="bold"
              tintColor="#FFFFFF"
            />
          ) : null}
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            numberOfLines={1}
            style={styles.buttonText}
          >
            {title}
          </Text>
        </LinearGradient>
      </Pressable>
    );
  }
  if (token === "divider")
    return <View style={[styles.divider, { backgroundColor: theme.separator }]} />;
  if (token === "spacer")
    return <View style={{ height: dynamicInteger(component.props.height) ?? 8 }} />;
  if (["walletbalance", "wallet_balance"].includes(token))
    return <DynamicWalletBalance component={component} onRoute={onRoute} />;
  if (["giftpreview", "gift_preview"].includes(token)) return <DynamicGiftPreview />;
  if (["agentlist", "agent_list"].includes(token))
    return <DynamicAgentList component={component} onRoute={onRoute} />;
  return null;
}

function DynamicWalletBalance({
  component,
  onRoute,
}: {
  component: DynamicComponent;
  onRoute: (route?: DynamicRoute) => void;
}) {
  const wallet = useWallet();
  const refreshBalance = wallet.refreshBalance;
  const { t } = useLocalization();
  const theme = dynamicScreenPalette(useColorScheme());
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);
  return (
    <View style={[styles.card, { backgroundColor: theme.card }]}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onRoute(component.action ?? { type: "native", name: "wallet" })}
        style={styles.walletRow}
      >
        <DynamicIcon component={component} fallback="pawprint.fill" size={metrics.walletIconSize} />
        <View style={styles.rowCopy}>
          <Text style={[styles.walletLabel, { color: theme.secondaryText }]}>
            {t("wallet.balance")}
          </Text>
          <Text style={[styles.walletBalance, { color: theme.text }]}>
            {wallet.balance?.gold_coin_balance ?? t("common.loading")}
          </Text>
        </View>
        <SymbolView
          name="chevron.right"
          size={13}
          weight="semibold"
          tintColor={theme.tertiaryText}
        />
      </Pressable>
    </View>
  );
}

function DynamicGiftPreview() {
  const { activeLanguage, t } = useLocalization();
  const theme = dynamicScreenPalette(useColorScheme());
  return (
    <View style={[styles.card, styles.giftRow, { backgroundColor: theme.card }]}>
      {fixedGiftCatalog.slice(0, 4).map((gift) => (
        <View key={gift.gift_id} style={styles.giftItem}>
          <GiftAssetIcon assetKey={gift.asset_key} size={metrics.giftIconSize} />
          <Text numberOfLines={1} style={[styles.giftName, { color: theme.secondaryText }]}>
            {localizedGiftCatalogName(gift, activeLanguage, t)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function DynamicAgentList({
  component,
  onRoute,
}: {
  component: DynamicComponent;
  onRoute: (route?: DynamicRoute) => void;
}) {
  const theme = dynamicScreenPalette(useColorScheme());
  return (
    <View style={[styles.card, { backgroundColor: theme.card }]}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onRoute(component.action ?? { type: "native", name: "agent_hub" })}
        style={styles.agentRow}
      >
        <LinearGradient colors={[theme.accent, theme.accentDark]} style={styles.agentAvatar}>
          <SymbolView
            name="sparkles"
            size={metrics.agentAvatarSize * 0.34}
            weight="semibold"
            tintColor="#FFFFFF"
          />
        </LinearGradient>
        <View style={styles.rowCopy}>
          <Text style={[styles.agentTitle, { color: theme.text }]}>Agent Platform</Text>
          <Text numberOfLines={1} style={[styles.agentSubtitle, { color: theme.secondaryText }]}>
            查看、调整并与我创建的智能体聊天
          </Text>
        </View>
        <SymbolView
          name="chevron.right"
          size={13}
          weight="semibold"
          tintColor={theme.tertiaryText}
        />
      </Pressable>
    </View>
  );
}

function DynamicIcon({
  component,
  fallback,
  size,
}: {
  component: DynamicComponent;
  fallback: string;
  size: number;
}) {
  const theme = dynamicScreenPalette(useColorScheme());
  const fill = dynamicIconGradient(component.props.colors, theme.accent);
  const systemImage = dynamicString(component.props.system_image) ?? fallback;
  const remoteIconKey = dynamicString(component.props.remote_icon_key);
  return (
    <LinearGradient
      colors={fill}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={{ borderRadius: 10, height: size, width: size }}
    >
      {remoteIconKey ? (
        <View style={{ flex: 1, padding: size * 0.22 }}>
          <DynamicRemoteAssetImage
            assetKey={remoteIconKey}
            fallbackSystemImage={systemImage}
            fallbackTintColor={theme.tertiaryText}
          />
        </View>
      ) : (
        <View style={styles.center}>
          <SymbolView
            name={systemImage as SFSymbol}
            size={size * 0.42}
            weight="semibold"
            tintColor="#FFFFFF"
          />
        </View>
      )}
    </LinearGradient>
  );
}

export function dynamicIconGradient(
  value: DynamicComponent["props"][string] | undefined,
  accent: string,
): readonly [string, string] {
  const validColors =
    dynamicArray(value)
      ?.flatMap((candidate) => {
        const normalized = normalizedSwiftHexColor(dynamicString(candidate));
        return normalized ? [normalized] : [];
      })
      .slice(0, 2) ?? [];
  const first = validColors[0] ?? accent;
  return validColors.length >= 2 ? [first, validColors[1]!] : [first, first];
}

function normalizedSwiftHexColor(value: string | undefined): string | null {
  const hex = value?.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/gu, "") ?? "";
  if (!/^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u.test(hex)) return null;
  // Swift Color(hex:) treats eight digits as AARRGGBB while React Native uses
  // RRGGBBAA, so rotate the alpha byte without changing the visual color.
  return hex.length === 8 ? `#${hex.slice(2)}${hex.slice(0, 2)}` : `#${hex}`;
}

const styles = StyleSheet.create({
  childStack: { gap: metrics.childSpacing },
  card: { borderRadius: metrics.cardCornerRadius, overflow: "hidden" },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: metrics.rowHorizontalPadding,
    paddingVertical: metrics.rowVerticalPadding,
  },
  rowCopy: { flex: 1, gap: 3, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: "500" },
  rowSubtitle: { fontSize: 13 },
  banner: {
    alignItems: "center",
    borderRadius: metrics.cardCornerRadius,
    flexDirection: "row",
    gap: 14,
    padding: metrics.bannerPadding,
  },
  bannerCopy: { flex: 1, gap: 5 },
  bannerTitle: { fontSize: 19, fontWeight: "700" },
  bannerSubtitle: { fontSize: 14 },
  titleText: { fontSize: 22, fontWeight: "700", width: "100%" },
  bodyText: { fontSize: 15, width: "100%" },
  legalDocumentCard: {
    borderRadius: metrics.cardCornerRadius,
    paddingHorizontal: 18,
    paddingVertical: 20,
    width: "100%",
  },
  legalDocumentBody: { fontSize: 16, lineHeight: 25, width: "100%" },
  image: { borderRadius: metrics.cardCornerRadius, overflow: "hidden", width: "100%" },
  button: {
    alignItems: "center",
    borderRadius: metrics.cardCornerRadius,
    flexDirection: "row",
    gap: 8,
    height: metrics.buttonHeight,
    justifyContent: "center",
  },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  divider: { height: StyleSheet.hairlineWidth, width: "100%" },
  walletRow: { alignItems: "center", flexDirection: "row", gap: 12, padding: 16 },
  walletLabel: { fontSize: 13 },
  walletBalance: { fontSize: 22, fontWeight: "700" },
  giftRow: { flexDirection: "row", gap: 12, padding: 14 },
  giftItem: { alignItems: "center", flex: 1, gap: 5, minWidth: 0 },
  giftName: { fontSize: 11, fontWeight: "500", width: "100%", textAlign: "center" },
  agentRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  agentAvatar: {
    alignItems: "center",
    borderRadius: 9.24,
    height: metrics.agentAvatarSize,
    justifyContent: "center",
    width: metrics.agentAvatarSize,
  },
  agentTitle: { fontSize: 15, fontWeight: "600" },
  agentSubtitle: { fontSize: 12 },
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
});
