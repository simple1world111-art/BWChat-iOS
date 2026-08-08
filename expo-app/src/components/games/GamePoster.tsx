import { LinearGradient } from "expo-linear-gradient";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { gameLaunchPolicy, type WebViewPolicy } from "@/services/web/WebViewPolicy";
import { allowsInitialGameURL } from "@/services/games/GameBridge";
import { gameCenterMetrics } from "@/services/games/GameCenterPolicy";
import { readAccessToken } from "@/storage/tokenStorage";
import { colors } from "@/theme";

const maximumSVGByteCount = 5 * 1_024 * 1_024;

export function GamePoster({
  url,
  policy,
  size = gameCenterMetrics.posterSize,
}: {
  url: string;
  policy: WebViewPolicy;
  size?: number;
}) {
  const isSVG = svgURL(url);
  const [state, setState] = useState<
    | { url: string; status: "loading" | "failed"; xml?: undefined }
    | { url: string; status: "loaded"; xml: string }
  >({ url, status: "loading" });

  useEffect(() => {
    if (!isSVG) return;
    let active = true;
    void loadSVG(url, gameLaunchPolicy(policy)).then((xml) => {
      if (!active) return;
      setState(xml ? { url, status: "loaded", xml } : { url, status: "failed" });
    });
    return () => {
      active = false;
    };
  }, [isSVG, policy, url]);

  const placeholder = (
    <LinearGradient colors={[colors.accent, colors.accentDark]} style={styles.fill}>
      {isSVG && (state.url !== url || state.status === "loading") ? (
        <ActivityIndicator color={colors.white} size="small" />
      ) : (
        <SymbolView
          name="gamecontroller.fill"
          size={gameCenterMetrics.posterPlaceholderIconSize}
          weight="medium"
          tintColor="rgba(255,255,255,0.8)"
        />
      )}
    </LinearGradient>
  );

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { width: size, height: size }]}
    >
      {isSVG ? (
        state.url === url && state.status === "loaded" ? (
          <SvgXml height="100%" preserveAspectRatio="xMidYMid slice" width="100%" xml={state.xml} />
        ) : (
          placeholder
        )
      ) : url.trim() ? (
        <AuthenticatedImage
          uri={url}
          contentFit="cover"
          errorFallback={placeholder}
          fallback={placeholder}
          style={styles.fill}
        />
      ) : (
        placeholder
      )}
    </View>
  );
}

async function loadSVG(url: string, policy: WebViewPolicy): Promise<string | undefined> {
  if (!allowsInitialGameURL(url, policy)) return undefined;
  const token = await readAccessToken();
  try {
    const response = await fetch(
      url,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    );
    if (!response.ok || !response.url || !allowsInitialGameURL(response.url, policy))
      return undefined;
    const declared = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > maximumSVGByteCount) return undefined;
    const xml = await response.text();
    if (!xml.trim() || new TextEncoder().encode(xml).byteLength > maximumSVGByteCount)
      return undefined;
    return xml;
  } catch {
    return undefined;
  }
}

function svgURL(value: string): boolean {
  try {
    return new URL(value).pathname.toLocaleLowerCase().endsWith(".svg");
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", borderRadius: gameCenterMetrics.posterRadius },
  fill: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
});
