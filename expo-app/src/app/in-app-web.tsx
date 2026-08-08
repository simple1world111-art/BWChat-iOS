import * as Application from "expo-application";
import * as Linking from "expo-linking";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { LinearGradient } from "expo-linear-gradient";

import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  allowsGameBridgeMessage,
  allowsInitialGameURL,
  decodeGameBridgeAction,
  failedRoundResult,
  GameBridgeValidationError,
  gameBridgeTypes,
  gameNavigationResolution,
  gameRoundErrorCodes,
  GameProfileOpenGate,
  isGameProfileScheme,
  isRoundResumeTokenFailure,
  makeRewardedResultJavaScript,
  makeRoundResultJavaScript,
  parseBridgeBody,
  RequestLedger,
  rewardedAddressFromBody,
  rewardedAdErrorCodes,
  roundAddressFromBody,
  roundBridgeErrorCode,
  roundIdentityFromBody,
  roundRequestAddress,
  shouldShowBlockingNavigationError,
  startedRoundResult,
  type GameRewardedAdResult,
  type GameRoundStartRequest,
  type GameRoundStartResult,
} from "@/services/games/GameBridge";
import {
  gameCenterErrorKey,
  recordPlayedGame,
  startGameRound,
} from "@/services/games/GameRepository";
import { GameAccountScope } from "@/services/games/GameAccountScope";
import type { GameCatalogItem } from "@/services/games/GameModels";
import {
  gameRewardedAdUnitAllowlist,
  prepareGameRewardedAds,
  presentGameRewardedAd,
} from "@/services/games/GameRewardedAdService";
import {
  appBridgeInfo,
  bridgeNavigationTitle,
  decodeAppBridgeRoute,
} from "@/services/web/AppBridge";
import { openDynamicRoute } from "@/services/web/DynamicRouteNavigator";
import {
  gameLaunchPolicy,
  policyAllowsURL,
  shouldOpenURLExternally,
} from "@/services/web/WebViewPolicy";
import { colors } from "@/theme";

type Params = {
  url?: string;
  title?: string;
  restrictToInitialOrigin?: string;
  gameID?: string;
  sessionID?: string;
  ownerID?: string;
  gameName?: string;
  posterURL?: string;
  iconURL?: string;
  summary?: string;
  gameType?: string;
  entryPriceGoldCoins?: string;
  sortOrder?: string;
};

type MainFrameMessageEvent = WebViewMessageEvent["nativeEvent"] & { isMainFrame?: boolean };

function bridgeBootstrap(includeGameBridge: boolean): string {
  return `(() => {
  const nativeBridge = window.ReactNativeWebView;
  if (!nativeBridge || typeof nativeBridge.postMessage !== "function") return true;
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = window.webkit.messageHandlers || {};
  const install = (name, channel) => {
    if (window.webkit.messageHandlers[name] && typeof window.webkit.messageHandlers[name].postMessage === "function") return;
    window.webkit.messageHandlers[name] = {
      postMessage(body) {
        nativeBridge.postMessage(JSON.stringify({ __bwchat_bridge: channel, body }));
      }
    };
  };
  install("bwchat", "app");
  ${includeGameBridge ? 'install("bwchatGameBridge", "game");' : ""}
  return true;
})(); true;`;
}

export default function InAppWebScreen() {
  const params = useLocalSearchParams<Params>();
  return <InAppWebContent params={params} />;
}

export function InAppWebContent({
  isTabRoot = false,
  params,
}: {
  isTabRoot?: boolean | undefined;
  params: Params;
}) {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const { activeLanguage, t } = useLocalization();
  const { config } = useRemoteConfig();
  const wallet = useWallet();
  const scheme = useColorScheme();
  const initialURL = value(params.url);
  const restrictToInitialOrigin = value(params.restrictToInitialOrigin) === "true";
  const policy = useMemo(
    () => (restrictToInitialOrigin ? gameLaunchPolicy(config.webViewPolicy) : config.webViewPolicy),
    [config.webViewPolicy, restrictToInitialOrigin],
  );
  const injectedBridgeBootstrap = useMemo(
    () => bridgeBootstrap(restrictToInitialOrigin),
    [restrictToInitialOrigin],
  );
  const gameID = value(params.gameID);
  const gameSessionID = value(params.sessionID);
  const gameOwnerID = value(params.ownerID);
  const gameContextMatchesOwner =
    !restrictToInitialOrigin || Boolean(ownerId && gameOwnerID && ownerId === gameOwnerID);
  const game = useMemo(() => gameFromParams(params), [params]);
  const adAllowlist = useMemo(
    () => new Set(gameRewardedAdUnitAllowlist(config.wallet, __DEV__)),
    [config.wallet],
  );
  const initialAllowed =
    gameContextMatchesOwner &&
    (restrictToInitialOrigin
      ? allowsInitialGameURL(initialURL, policy)
      : policyAllowsURL(initialURL, policy, {
          allowDevelopmentLocalhost: __DEV__,
        }));

  const [pageTitle, setPageTitle] = useState(() => rawValue(params.title));
  const [isLoading, setLoading] = useState(true);
  const [blockedMessage, setBlockedMessage] = useState<string>();
  const [toastMessage, setToastMessage] = useState<string>();
  const [reloadID, setReloadID] = useState(0);
  const [isStartingRound, setStartingRound] = useState(false);
  const [paymentBlockedSessionID, setPaymentBlockedSessionID] = useState<string>();
  const webViewRef = useRef<WebView>(null);
  const currentURLRef = useRef(initialURL);
  const hasFinishedInitialDocumentRef = useRef(false);
  const mountedRef = useRef(true);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const profileOpenGateRef = useRef(new GameProfileOpenGate());
  const rewardedLedgerRef = useRef(new RequestLedger());
  const roundLedgerRef = useRef(new RequestLedger());
  const roundInFlightRef = useRef<GameRoundStartRequest | undefined>(undefined);
  const accountScopeRef = useRef(new GameAccountScope(ownerId));

  useLayoutEffect(() => {
    if (!accountScopeRef.current.updateOwner(ownerId)) return;
    profileOpenGateRef.current = new GameProfileOpenGate();
    rewardedLedgerRef.current = new RequestLedger();
    roundLedgerRef.current = new RequestLedger();
    roundInFlightRef.current = undefined;
    currentURLRef.current = initialURL;
    hasFinishedInitialDocumentRef.current = false;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(undefined);
    setPaymentBlockedSessionID(undefined);
    setBlockedMessage(undefined);
    setLoading(true);
    const timer = setTimeout(() => {
      if (mountedRef.current) setStartingRound(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialURL, ownerId]);

  const roundInteractionLocked = isStartingRound && gameContextMatchesOwner;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (restrictToInitialOrigin) void prepareGameRewardedAds([...adAllowlist]);
  }, [adAllowlist, restrictToInitialOrigin]);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(undefined), 2_000);
  }, []);

  const injectRoundResult = useCallback((result: GameRoundStartResult) => {
    webViewRef.current?.injectJavaScript(makeRoundResultJavaScript(result));
  }, []);

  const deliverRoundOnce = useCallback(
    (identity: { requestID: string; sessionID: string }, result: GameRoundStartResult) => {
      const address = roundRequestAddress(identity);
      if (!roundLedgerRef.current.complete(address)) return;
      injectRoundResult(result);
    },
    [injectRoundResult],
  );

  const rejectRoundIfAddressable = useCallback(
    (body: Record<string, unknown>, errorCode: string) => {
      const identity = roundIdentityFromBody(body);
      const address = roundAddressFromBody(body);
      if (!identity || !address) {
        showToast(t("common.operationFailed"));
        return;
      }
      if (!roundLedgerRef.current.begin(address)) return;
      deliverRoundOnce(identity, failedRoundResult(identity, errorCode));
    },
    [deliverRoundOnce, showToast, t],
  );

  const injectRewardedResult = useCallback((result: GameRewardedAdResult) => {
    webViewRef.current?.injectJavaScript(makeRewardedResultJavaScript(result));
  }, []);

  const deliverRewardedOnce = useCallback(
    (result: GameRewardedAdResult) => {
      const id = result.request_id;
      if (!rewardedLedgerRef.current.complete(id)) return;
      injectRewardedResult(result);
    },
    [injectRewardedResult],
  );

  const rejectRewardedIfAddressable = useCallback(
    (body: Record<string, unknown>, status: GameRewardedAdResult["status"], errorCode: string) => {
      const address = rewardedAddressFromBody(body);
      if (!address) {
        showToast(t("common.operationFailed"));
        return;
      }
      if (!rewardedLedgerRef.current.begin(address.requestID)) return;
      deliverRewardedOnce({
        request_id: address.requestID,
        session_id: address.sessionID,
        status,
        error_code: errorCode,
      });
    },
    [deliverRewardedOnce, showToast, t],
  );

  const handleRoundStart = useCallback(
    async (request: GameRoundStartRequest) => {
      const address = roundRequestAddress(request);
      if (!roundLedgerRef.current.begin(address)) return;
      const operationOwnerTicket = accountScopeRef.current.capture();
      if (
        !gameContextMatchesOwner ||
        !gameID ||
        !gameSessionID ||
        request.source !== gameID ||
        request.sessionID !== gameSessionID
      ) {
        deliverRoundOnce(request, failedRoundResult(request, gameRoundErrorCodes.contextMismatch));
        return;
      }
      if (paymentBlockedSessionID === gameSessionID) {
        deliverRoundOnce(
          request,
          failedRoundResult(request, gameRoundErrorCodes.resumeTokenFailure),
        );
        return;
      }
      if (roundInFlightRef.current) {
        deliverRoundOnce(
          request,
          failedRoundResult(request, gameRoundErrorCodes.paymentAlreadyShowing),
        );
        return;
      }

      roundInFlightRef.current = request;
      setStartingRound(true);
      try {
        const round = await startGameRound(gameID, gameSessionID, request.requestID);
        if (
          !accountScopeRef.current.isCurrent(operationOwnerTicket) ||
          operationOwnerTicket.ownerId !== gameOwnerID
        ) {
          deliverRoundOnce(
            request,
            failedRoundResult(request, gameRoundErrorCodes.contextMismatch),
          );
          return;
        }
        await wallet.applyBalance(round.walletBalance);
        if (
          !accountScopeRef.current.isCurrent(operationOwnerTicket) ||
          operationOwnerTicket.ownerId !== gameOwnerID
        ) {
          deliverRoundOnce(
            request,
            failedRoundResult(request, gameRoundErrorCodes.contextMismatch),
          );
          return;
        }
        if (ownerId && game) await recordPlayedGame(ownerId, game);
        if (
          !accountScopeRef.current.isCurrent(operationOwnerTicket) ||
          operationOwnerTicket.ownerId !== gameOwnerID
        ) {
          deliverRoundOnce(
            request,
            failedRoundResult(request, gameRoundErrorCodes.contextMismatch),
          );
          return;
        }
        deliverRoundOnce(request, startedRoundResult(request, round));
      } catch (error) {
        if (
          !accountScopeRef.current.isCurrent(operationOwnerTicket) ||
          operationOwnerTicket.ownerId !== gameOwnerID
        ) {
          deliverRoundOnce(
            request,
            failedRoundResult(request, gameRoundErrorCodes.contextMismatch),
          );
          return;
        }
        const resumeFailure = isRoundResumeTokenFailure(error);
        if (resumeFailure) setPaymentBlockedSessionID(gameSessionID);
        await wallet.refreshBalance(true);
        showToast(t(gameCenterErrorKey(error)));
        deliverRoundOnce(
          request,
          failedRoundResult(
            request,
            resumeFailure ? gameRoundErrorCodes.resumeTokenFailure : roundBridgeErrorCode(error),
          ),
        );
      } finally {
        if (roundInFlightRef.current?.requestID === request.requestID) {
          roundInFlightRef.current = undefined;
        }
        if (mountedRef.current) setStartingRound(false);
      }
    },
    [
      deliverRoundOnce,
      game,
      gameContextMatchesOwner,
      gameID,
      gameOwnerID,
      gameSessionID,
      ownerId,
      paymentBlockedSessionID,
      showToast,
      t,
      wallet,
    ],
  );

  const openUserProfile = useCallback((userID: string) => {
    if (!profileOpenGateRef.current.shouldOpen(userID)) return;
    router.push({ pathname: "/user-profile", params: { id: userID } });
  }, []);

  const handleGameMessage = useCallback(
    async (body: Record<string, unknown>, nativeEvent: MainFrameMessageEvent) => {
      const isRound = body.type === gameBridgeTypes.roundStart;
      const isRewarded = body.type === gameBridgeTypes.rewardedAd;
      const trusted =
        gameContextMatchesOwner &&
        restrictToInitialOrigin &&
        allowsGameBridgeMessage({
          isMainFrame: nativeEvent.isMainFrame === true,
          currentURL: currentURLRef.current,
          frameURL: nativeEvent.url,
          initialURL,
          requiresHTTPS: isRound || isRewarded,
          policy,
        });
      if (!trusted) {
        if (isRound) rejectRoundIfAddressable(body, gameRoundErrorCodes.untrustedGameOrigin);
        else if (isRewarded) {
          rejectRewardedIfAddressable(body, "failed", rewardedAdErrorCodes.untrustedGameOrigin);
        } else showToast(t("common.operationFailed"));
        return;
      }

      try {
        const action = decodeGameBridgeAction(body);
        if (action.kind === "profile") {
          openUserProfile(action.message.userID);
          return;
        }
        if (action.kind === "roundStart") {
          await handleRoundStart(action.request);
          return;
        }
        if (!adAllowlist.has(action.request.adUnitID)) {
          if (rewardedLedgerRef.current.begin(action.request.requestID)) {
            deliverRewardedOnce({
              request_id: action.request.requestID,
              session_id: action.request.sessionID,
              status: "failed",
              error_code: rewardedAdErrorCodes.adUnitNotAllowed,
            });
          }
          return;
        }
        if (!rewardedLedgerRef.current.begin(action.request.requestID)) return;
        deliverRewardedOnce(await presentGameRewardedAd(action.request));
      } catch (error) {
        const reason =
          error instanceof GameBridgeValidationError ? error.reason : "unknown_validation_error";
        if (isRound) rejectRoundIfAddressable(body, gameRoundErrorCodes.invalidMessage);
        else if (isRewarded)
          rejectRewardedIfAddressable(body, "failed", rewardedAdErrorCodes.invalidMessage);
        else {
          void reason;
          showToast(t("common.operationFailed"));
        }
      }
    },
    [
      adAllowlist,
      deliverRewardedOnce,
      gameContextMatchesOwner,
      handleRoundStart,
      initialURL,
      openUserProfile,
      policy,
      rejectRewardedIfAddressable,
      rejectRoundIfAddressable,
      restrictToInitialOrigin,
      showToast,
      t,
    ],
  );

  const handleAppMessage = useCallback(
    async (body: Record<string, unknown>) => {
      const method = typeof body.method === "string" ? body.method : "";
      if (!policy.allowedBridgeMethods.includes(method as never)) return;
      switch (method) {
        case "close":
          if (!isTabRoot) router.back();
          break;
        case "openRoute": {
          const route = decodeAppBridgeRoute(
            Object.prototype.hasOwnProperty.call(body, "route") ? body.route : body.payload,
          );
          const outcome = await openDynamicRoute(
            route,
            policy,
            pageTitle || t("common.operationFailed"),
            t("discover.comingSoon"),
            activeLanguage,
            t,
          );
          if (!outcome.handled) {
            Alert.alert(outcome.title, outcome.message, [{ text: t("common.ok") }]);
          }
          break;
        }
        case "getAppInfo": {
          const payload = JSON.stringify(
            appBridgeInfo(
              Application.nativeApplicationVersion,
              Application.nativeBuildVersion,
              Platform.OS === "ios" ? "iOS" : Platform.OS,
            ),
          ).replaceAll("<", "\\u003c");
          webViewRef.current?.injectJavaScript(
            `window.dispatchEvent(new CustomEvent('BWChatAppInfo',{detail:${payload}})); true;`,
          );
          break;
        }
        case "setNavigationTitle": {
          const title = bridgeNavigationTitle(body.title);
          if (title) setPageTitle(title);
          break;
        }
      }
    },
    [activeLanguage, isTabRoot, pageTitle, policy, t],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const envelope = parseBridgeBody(event.nativeEvent.data);
      if (!envelope) return;
      const channel = envelope.__bwchat_bridge;
      const body =
        channel && parseBridgeBody(envelope.body) ? parseBridgeBody(envelope.body) : envelope;
      if (!body) return;
      if (
        channel === "game" ||
        (typeof body.type === "string" && body.type.startsWith("bwchat.game."))
      ) {
        void handleGameMessage(body, event.nativeEvent as MainFrameMessageEvent);
      } else {
        void handleAppMessage(body);
      }
    },
    [handleAppMessage, handleGameMessage],
  );

  const onShouldStart = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      const nextURL = request.url;
      if (restrictToInitialOrigin) {
        const resolution = gameNavigationResolution(nextURL, initialURL);
        if (resolution.kind === "profile") openUserProfile(resolution.userID);
        else if (resolution.kind === "cancel" && isGameProfileScheme(nextURL)) {
          showToast(t("common.operationFailed"));
        }
        return resolution.kind === "allow";
      }
      if (shouldOpenURLExternally(nextURL)) {
        void Linking.openURL(nextURL).catch(() => undefined);
        return false;
      }
      if (
        !policyAllowsURL(nextURL, policy, {
          allowDevelopmentLocalhost: __DEV__,
        })
      ) {
        setLoading(false);
        setBlockedMessage(t("common.operationFailed"));
        return false;
      }
      return true;
    },
    [initialURL, openUserProfile, policy, restrictToInitialOrigin, showToast, t],
  );

  const onNavigationStateChange = useCallback((navigation: WebViewNavigation) => {
    if (navigation.url) currentURLRef.current = navigation.url;
  }, []);

  const retry = () => {
    setBlockedMessage(undefined);
    setLoading(true);
    currentURLRef.current = initialURL;
    hasFinishedInitialDocumentRef.current = false;
    setReloadID((current) => current + 1);
  };

  const visibleBlock =
    blockedMessage ?? (!initialAllowed ? t("common.operationFailed") : undefined);

  return (
    <View style={[styles.screen, { backgroundColor: scheme === "dark" ? "#1C1C1E" : "#F2F2F7" }]}>
      {isTabRoot ? (
        <View style={styles.tabRootHeader}>
          <Text numberOfLines={1} style={styles.tabRootHeaderTitle}>
            {pageTitle}
          </Text>
        </View>
      ) : (
        <Stack.Screen
          options={{
            gestureEnabled: !restrictToInitialOrigin,
            headerShown: true,
            headerBackVisible: false,
            headerShadowVisible: false,
            headerStyle: { backgroundColor: "transparent" },
            headerTitle: pageTitle,
            headerTitleStyle: { fontSize: 17, fontWeight: "600" },
            headerLeft: () => (
              <Pressable
                accessibilityLabel={t("common.back")}
                accessibilityRole="button"
                accessibilityState={{ disabled: roundInteractionLocked }}
                disabled={roundInteractionLocked}
                hitSlop={8}
                onPress={() => router.back()}
                style={styles.backButton}
              >
                <SymbolView
                  name="chevron.left"
                  size={17}
                  weight="semibold"
                  tintColor={colors.text}
                />
              </Pressable>
            ),
          }}
        />
      )}

      {visibleBlock ? (
        <BlockedState message={visibleBlock} retry={retry} />
      ) : (
        <WebView
          key={`${initialURL}.${reloadID}`}
          ref={webViewRef}
          allowsBackForwardNavigationGestures={!restrictToInitialOrigin}
          allowsInlineMediaPlayback
          cacheEnabled
          domStorageEnabled
          incognito={false}
          injectedJavaScriptBeforeContentLoaded={injectedBridgeBootstrap}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          javaScriptCanOpenWindowsAutomatically={false}
          mediaCapturePermissionGrantType="deny"
          onError={() => {
            setLoading(false);
            if (shouldShowBlockingNavigationError(hasFinishedInitialDocumentRef.current)) {
              setBlockedMessage(t("gameCenter.sessionFailed"));
            }
          }}
          onLoad={() => {
            setLoading(false);
            hasFinishedInitialDocumentRef.current = true;
          }}
          onLoadStart={(event) => {
            setLoading(true);
            if (event.nativeEvent.url) currentURLRef.current = event.nativeEvent.url;
          }}
          onMessage={onMessage}
          onNavigationStateChange={onNavigationStateChange}
          onOpenWindow={() => undefined}
          onShouldStartLoadWithRequest={onShouldStart}
          originWhitelist={["*"]}
          setSupportMultipleWindows={false}
          sharedCookiesEnabled
          source={{ uri: initialURL }}
          thirdPartyCookiesEnabled
          style={styles.webView}
        />
      )}

      {isLoading && !visibleBlock ? (
        <View
          accessible
          accessibilityLabel={t("common.loading")}
          accessibilityRole="progressbar"
          pointerEvents="none"
          style={styles.loadingOverlay}
        >
          <ActivityIndicator color={colors.accent} size="small" style={styles.loadingSpinner} />
        </View>
      ) : null}

      {roundInteractionLocked ? (
        <View
          accessible
          accessibilityLabel={t("common.loading")}
          accessibilityRole="progressbar"
          accessibilityViewIsModal
          style={styles.paymentOverlay}
        >
          <ActivityIndicator color="#FFFFFF" size="small" style={styles.paymentSpinner} />
        </View>
      ) : null}

      {toastMessage ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          pointerEvents="none"
          style={styles.toast}
        >
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

function BlockedState({ message, retry }: { message: string; retry(): void }) {
  const { t } = useLocalization();
  return (
    <View accessibilityLiveRegion="polite" style={styles.blocked}>
      <SymbolView
        accessibilityElementsHidden
        accessible={false}
        name="lock.shield"
        size={38}
        weight="semibold"
        tintColor={colors.tertiaryText}
      />
      <Text style={styles.blockedText}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={retry}>
        <LinearGradient colors={[colors.accent, colors.accentDark]} style={styles.retryButton}>
          <Text style={styles.retryText}>{t("common.retry")}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function gameFromParams(params: Params): GameCatalogItem | undefined {
  const id = value(params.gameID);
  const name = value(params.gameName) || value(params.title);
  const posterURL = value(params.posterURL);
  const sortOrder = Number(value(params.sortOrder));
  if (!id || !name || !posterURL || !Number.isSafeInteger(sortOrder)) return undefined;
  const iconURL = value(params.iconURL);
  const summary = value(params.summary);
  const gameType = value(params.gameType);
  const priceText = value(params.entryPriceGoldCoins);
  const price = priceText ? Number(priceText) : undefined;
  return {
    id,
    name,
    posterURL,
    ...(iconURL ? { iconURL } : {}),
    ...(summary ? { summary } : {}),
    ...(gameType ? { gameType } : {}),
    ...(price !== undefined && Number.isSafeInteger(price) && price >= 0
      ? { entryPriceGoldCoins: price }
      : {}),
    sortOrder,
  };
}

function value(input: string | string[] | undefined): string {
  return Array.isArray(input) ? (input[0]?.trim() ?? "") : (input?.trim() ?? "");
}

function rawValue(input: string | string[] | undefined): string {
  return Array.isArray(input) ? (input[0] ?? "") : (input ?? "");
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  webView: { flex: 1, backgroundColor: "#FFFFFF" },
  backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  tabRootHeader: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 52,
  },
  tabRootHeaderTitle: { color: colors.text, fontSize: 17, fontWeight: "600" },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 14 },
  blockedText: {
    paddingHorizontal: 28,
    color: colors.secondaryText,
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
  },
  retryButton: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingSpinner: { transform: [{ scale: 1.1 }] },
  paymentOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.36)",
  },
  paymentSpinner: { transform: [{ scale: 1.15 }] },
  toast: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toastText: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.75)",
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "400",
  },
});
