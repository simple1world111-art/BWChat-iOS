import SwiftUI
import WebKit
import OSLog

struct GameEntryContext {
    let gameID: String
    let sessionID: String
    let walletStore: WalletStore
    let startRound: @MainActor (GameRoundStartRequest) async throws -> GameRoundStart
}

private struct PendingGameRoundStart {
    let request: GameRoundStartRequest
    let completion: (GameRoundStartBridgeResult) -> Void
}

struct InAppWebView: View {
    let url: URL
    let restrictToInitialOrigin: Bool
    let gameEntryContext: GameEntryContext?

    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var remoteConfig = AppRemoteConfigStore.shared
    @State private var pageTitle: String
    @State private var isLoading = true
    @State private var blockedMessage: String?
    @State private var bridgeToastMessage: String?
    @State private var routeAlert: DynamicRouteAlert?
    @State private var reloadID = UUID()
    @State private var pendingGameRoundStart: PendingGameRoundStart?
    @State private var isStartingGameRound = false
    @State private var paymentBlockedSessionID: String?

    init(
        url: URL,
        title: String,
        restrictToInitialOrigin: Bool = false,
        gameEntryContext: GameEntryContext? = nil
    ) {
        self.url = url
        self.restrictToInitialOrigin = restrictToInitialOrigin
        self.gameEntryContext = gameEntryContext
        self._pageTitle = State(initialValue: title)
    }

    var body: some View {
        ZStack {
            if let blockedMessage {
                blockedState(blockedMessage)
            } else if initialURLIsAllowed {
                HardenedWebViewRepresentable(
                    url: url,
                    policy: effectiveWebViewPolicy,
                    restrictToInitialOrigin: restrictToInitialOrigin,
                    isLoading: $isLoading,
                    blockedMessage: $blockedMessage,
                    onClose: { navigator.pop() },
                    onOpenRoute: { route in
                        switch DynamicRouteHandler.open(route, navigator: navigator, fallbackTitle: pageTitle) {
                        case .handled:
                            break
                        case .alert(let alert):
                            routeAlert = alert
                        }
                    },
                    onSetTitle: { title in
                        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                        pageTitle = String(title.prefix(40))
                    },
                    onOpenUserProfile: { userID in
                        navigator.openUserProfile(userID: userID)
                    },
                    onRequestGameRoundStart: receiveGameRoundStartRequest,
                    onBridgeFailure: {
                        bridgeToastMessage = L10n.tr("common.operationFailed")
                    }
                )
                .id(reloadID)
                .ignoresSafeArea(edges: .bottom)
            } else {
                blockedState(L10n.tr("common.operationFailed"))
            }

            if isLoading && blockedMessage == nil {
                ProgressView()
                    .tint(AppColors.accent)
                    .scaleEffect(1.1)
            }

            if isStartingGameRound {
                ZStack {
                    Color.black.opacity(0.36).ignoresSafeArea()
                    ProgressView().tint(.white).scaleEffect(1.15)
                }
                .zIndex(3)
            }
        }
        .navigationTitle(pageTitle)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton(onBack: {
            guard !isStartingGameRound else { return }
            navigator.pop()
        })
        .toast(message: $bridgeToastMessage)
        .alert(item: $routeAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text(L10n.tr("common.ok")))
            )
        }
        .task(id: url) {
            guard restrictToInitialOrigin else { return }
            await RewardedAdCoordinator.shared.preload(
                adUnitIDs: GameRewardedAdUnitAllowlist.currentAdUnitIDs
            )
        }
    }

    private var initialURLIsAllowed: Bool {
        if restrictToInitialOrigin {
            return GameWebSecurity.allowsInitialGameURL(url, policy: effectiveWebViewPolicy)
        }
        return effectiveWebViewPolicy.allows(url)
    }

    private var effectiveWebViewPolicy: WebViewPolicy {
        let policy = remoteConfig.config.webViewPolicy
        return restrictToInitialOrigin ? policy.gameLaunchPolicy : policy
    }

    private func receiveGameRoundStartRequest(
        _ request: GameRoundStartRequest,
        completion: @escaping (GameRoundStartBridgeResult) -> Void
    ) {
        guard let gameEntryContext,
              request.source == gameEntryContext.gameID,
              request.sessionID == gameEntryContext.sessionID else {
            completion(.failed(
                request: request,
                errorCode: GameRoundStartErrorCode.contextMismatch
            ))
            return
        }
        guard paymentBlockedSessionID != gameEntryContext.sessionID else {
            completion(.failed(
                request: request,
                errorCode: GameRoundStartErrorCode.resumeTokenFailure
            ))
            return
        }
        guard pendingGameRoundStart == nil, !isStartingGameRound else {
            completion(.failed(
                request: request,
                errorCode: GameRoundStartErrorCode.paymentAlreadyShowing
            ))
            return
        }
        let pending = PendingGameRoundStart(
            request: request,
            completion: completion
        )
        pendingGameRoundStart = pending
        startPendingGameRound(pending, context: gameEntryContext)
    }

    private func startPendingGameRound(
        _ pending: PendingGameRoundStart,
        context: GameEntryContext
    ) {
        guard pendingGameRoundStart?.request.requestID == pending.request.requestID,
              !isStartingGameRound else { return }
        isStartingGameRound = true

        Task { @MainActor in
            do {
                let round = try await context.startRound(pending.request)
                context.walletStore.applyServerBalance(round.walletBalance)
                pending.completion(.started(
                    request: pending.request,
                    round: round
                ))
                pendingGameRoundStart = nil
                isStartingGameRound = false
            } catch is CancellationError {
                pending.completion(.cancelled(request: pending.request))
                pendingGameRoundStart = nil
                isStartingGameRound = false
            } catch {
                let isResumeTokenFailure = GameRoundStartFailureClassifier
                    .isResumeTokenFailure(error)
                if isResumeTokenFailure {
                    paymentBlockedSessionID = context.sessionID
                }
                await context.walletStore.refreshBalanceFromServer(forceRefresh: true)
                bridgeToastMessage = GameRoundStartErrorText.message(for: error)
                pending.completion(.failed(
                    request: pending.request,
                    errorCode: isResumeTokenFailure
                        ? GameRoundStartErrorCode.resumeTokenFailure
                        : GameRoundStartFailureClassifier.bridgeErrorCode(for: error)
                            ?? GameRoundStartErrorCode.paymentFailed
                ))
                pendingGameRoundStart = nil
                isStartingGameRound = false
            }
        }
    }

    private func blockedState(_ message: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "lock.shield")
                .font(.system(size: 38, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)

            Text(message)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)

            Button {
                blockedMessage = nil
                isLoading = true
                reloadID = UUID()
            } label: {
                Text(L10n.tr("common.retry"))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(AppColors.accentGradient)
                    .cornerRadius(12)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppColors.secondaryBackground)
    }
}

private struct HardenedWebViewRepresentable: UIViewRepresentable {
    let url: URL
    let policy: WebViewPolicy
    let restrictToInitialOrigin: Bool
    @Binding var isLoading: Bool
    @Binding var blockedMessage: String?
    let onClose: () -> Void
    let onOpenRoute: (DynamicRoute) -> Void
    let onSetTitle: (String) -> Void
    let onOpenUserProfile: (String) -> Bool
    let onRequestGameRoundStart: (
        GameRoundStartRequest,
        @escaping (GameRoundStartBridgeResult) -> Void
    ) -> Void
    let onBridgeFailure: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = restrictToInitialOrigin
            ? GameWebViewPool.shared.acquire()
            : GameWebViewPool.makeWebView()
        let userContentController = webView.configuration.userContentController
        userContentController.removeScriptMessageHandler(forName: BridgeHandlerName.app)
        userContentController.removeScriptMessageHandler(forName: BridgeHandlerName.game)
        userContentController.add(
            WeakScriptMessageHandler(delegate: context.coordinator),
            name: BridgeHandlerName.app
        )
        if restrictToInitialOrigin {
            userContentController.add(
                WeakScriptMessageHandler(delegate: context.coordinator),
                name: BridgeHandlerName.game
            )
        }
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        // Game canvases commonly use horizontal drags. Keep those gestures
        // inside the game instead of interpreting them as web history.
        webView.allowsBackForwardNavigationGestures = !restrictToInitialOrigin
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.update(parent: self)
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: BridgeHandlerName.app)
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: BridgeHandlerName.game)
        if coordinator.usesGameWebViewPool {
            GameWebViewPool.shared.recycle(uiView)
        } else {
            uiView.loadHTMLString("", baseURL: nil)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private static let logger = Logger(
            subsystem: Bundle.main.bundleIdentifier ?? "BWChat",
            category: "GameBridge"
        )

        private var parent: HardenedWebViewRepresentable
        private var profileOpenGate = GameProfileOpenGate()
        private var rewardedRequestLedger = GameRewardedAdRequestLedger()
        private var roundStartRequestLedger = GameRoundStartRequestLedger()
        private var hasFinishedInitialDocument = false

        var usesGameWebViewPool: Bool {
            parent.restrictToInitialOrigin
        }

        init(_ parent: HardenedWebViewRepresentable) {
            self.parent = parent
        }

        func update(parent: HardenedWebViewRepresentable) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            hasFinishedInitialDocument = true
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError _: Error) {
            handleNavigationFailure()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError _: Error) {
            handleNavigationFailure()
        }

        private func handleNavigationFailure() {
            parent.isLoading = false
            guard GameNavigationFailurePolicy.shouldShowBlockingError(
                hasFinishedInitialDocument: hasFinishedInitialDocument
            ) else {
                // A failed same-origin route or H5 recovery navigation must not
                // destroy an already rendered game with a full-screen error.
                Self.logger.notice("game_navigation_failure scope=post_load action=keep_document")
                return
            }
            parent.blockedMessage = L10n.tr("gameCenter.sessionFailed")
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let nextURL = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if parent.restrictToInitialOrigin {
                switch GameWebSecurity.navigationResolution(for: nextURL, initialURL: parent.url) {
                case .allow:
                    decisionHandler(.allow)
                case .openUserProfile(let userID):
                    routeToUserProfile(userID, transport: "deep_link")
                    decisionHandler(.cancel)
                case .cancel:
                    if nextURL.scheme?.lowercased() == GameProfileRoute.scheme {
                        reportBridgeFailure(reason: "invalid_deep_link")
                    } else if !GameWebSecurity.isWebURL(nextURL) {
                        Self.logger.error("profile_route_rejected reason=unknown_custom_scheme")
                    }
                    decisionHandler(.cancel)
                }
                return
            }

            if shouldOpenExternally(nextURL) {
                UIApplication.shared.open(nextURL)
                decisionHandler(.cancel)
                return
            }

            guard parent.policy.allows(nextURL) else {
                parent.isLoading = false
                parent.blockedMessage = L10n.tr("common.operationFailed")
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.deny)
        }

        func webView(
            _ webView: WKWebView,
            requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.deny)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == BridgeHandlerName.game {
                handleGameBridgeMessage(message)
                return
            }

            guard message.name == BridgeHandlerName.app,
                  let body = message.body as? [String: Any],
                  let method = body["method"] as? String,
                  parent.policy.allowedBridgeMethods.contains(method) else {
                return
            }

            switch method {
            case "close":
                parent.onClose()
            case "openRoute":
                if let route = decodeRoute(from: body["route"] ?? body["payload"]) {
                    parent.onOpenRoute(route)
                }
            case "getAppInfo":
                sendAppInfo(to: message.webView)
            case "setNavigationTitle":
                if let title = body["title"] as? String {
                    parent.onSetTitle(title)
                }
            default:
                break
            }
        }

        private func handleGameBridgeMessage(_ message: WKScriptMessage) {
            guard parent.restrictToInitialOrigin,
                  let body = message.body as? [String: Any] else {
                reportBridgeFailure(reason: "invalid_body")
                return
            }

            let messageURL = message.frameInfo.request.url ?? message.webView?.url
            let isRewardedAdRequest = body["type"] as? String == GameBridgeRouter.rewardedAdType
            let isRoundStartRequest = body["type"] as? String == GameBridgeRouter.roundStartType
            let requiresHTTPS = (isRewardedAdRequest || isRoundStartRequest)
                && GameWebSecurity.rewardedBridgeRequiresHTTPS(for: parent.url)
            guard GameWebSecurity.allowsGameBridgeMessage(
                isMainFrame: message.frameInfo.isMainFrame,
                currentURL: message.webView?.url,
                frameURL: messageURL,
                initialURL: parent.url,
                requiresHTTPS: requiresHTTPS,
                policy: parent.policy
            ) else {
                if isRoundStartRequest {
                    rejectRoundStartRequestIfAddressable(
                        body,
                        webView: message.webView,
                        errorCode: GameRoundStartErrorCode.untrustedGameOrigin
                    )
                } else {
                    rejectRewardedRequestIfAddressable(
                        body,
                        webView: message.webView,
                        status: .failed,
                        errorCode: GameRewardedAdErrorCode.untrustedGameOrigin
                    )
                }
                return
            }
            if isRewardedAdRequest,
               messageURL?.scheme?.lowercased() == "http" {
                Self.logger.notice("rewarded_ad_bridge_transport mode=trusted_legacy_http")
            }

            do {
                switch try GameBridgeRouter.decode(body) {
                case .openUserProfile(let bridgeMessage):
                    routeToUserProfile(bridgeMessage.userID, transport: "script_message")
                case .showRewardedAd(let request):
                    guard GameRewardedAdUnitAllowlist.currentAllows(request.adUnitID) else {
                        deliverRewardedResultOnce(
                            GameRewardedAdResult(
                                requestID: request.requestID,
                                sessionID: request.sessionID,
                                status: .failed,
                                errorCode: GameRewardedAdErrorCode.adUnitNotAllowed
                            ),
                            to: message.webView
                        )
                        return
                    }
                    Self.logger.notice(
                        "rewarded_ad_bridge_validated origin=true allowlist=true ad_unit_suffix=\(String(request.adUnitID.suffix(8)), privacy: .public)"
                    )
                    presentRewardedAd(request, webView: message.webView)
                case .requestRoundStart(let request):
                    presentRoundStartPayment(request, webView: message.webView)
                }
            } catch let error as GameRoundStartValidationError {
                Self.logger.error(
                    "round_start_invalid_message detail=\(error.rawValue, privacy: .public)"
                )
                rejectRoundStartRequestIfAddressable(
                    body,
                    webView: message.webView,
                    errorCode: GameRoundStartErrorCode.invalidMessage
                )
            } catch let error as GameRewardedAdValidationError {
                Self.logger.error(
                    "rewarded_ad_invalid_message detail=\(error.rawValue, privacy: .public)"
                )
                rejectRewardedRequestIfAddressable(
                    body,
                    webView: message.webView,
                    status: .failed,
                    errorCode: GameRewardedAdErrorCode.invalidMessage
                )
            } catch let error as GameBridgeValidationError {
                reportBridgeFailure(reason: error.rawValue)
            } catch let error as GameBridgeRoutingError {
                reportBridgeFailure(reason: error.rawValue)
            } catch {
                reportBridgeFailure(reason: "unknown_validation_error")
            }
        }

        private func presentRoundStartPayment(
            _ request: GameRoundStartRequest,
            webView: WKWebView?
        ) {
            guard roundStartRequestLedger.begin(address: request.address) else {
                Self.logger.debug("round_start_ignored reason=duplicate_request")
                return
            }
            Self.logger.notice(
                "round_start_payment_requested source=\(request.source, privacy: .public) trigger=\(request.trigger, privacy: .public)"
            )
            parent.onRequestGameRoundStart(request) { [weak self, weak webView] result in
                guard let self,
                      result.address == request.address,
                      self.roundStartRequestLedger.complete(address: request.address) else {
                    return
                }
                self.sendRoundStartResult(result, to: webView)
            }
        }

        private func rejectRoundStartRequestIfAddressable(
            _ body: [String: Any],
            webView: WKWebView?,
            errorCode: String
        ) {
            guard let address = GameRoundStartRequest.address(from: body) else {
                reportBridgeFailure(reason: errorCode)
                return
            }
            let result = GameRoundStartBridgeResult.failed(
                address: address,
                errorCode: errorCode
            )
            guard roundStartRequestLedger.begin(address: result.address),
                  roundStartRequestLedger.complete(address: result.address) else {
                return
            }
            sendRoundStartResult(result, to: webView)
        }

        private func sendRoundStartResult(
            _ result: GameRoundStartBridgeResult,
            to webView: WKWebView?
        ) {
            guard let webView else { return }
            Self.logger.notice(
                "round_start_terminal status=\(result.status.rawValue, privacy: .public) error=\(result.errorCode ?? "none", privacy: .public)"
            )
            webView.callAsyncJavaScript(
                GameRoundStartJavaScript.callbackSource,
                arguments: ["result": result.javaScriptPayload],
                in: nil,
                in: .page
            ) { evaluation in
                if case .failure = evaluation {
                    Self.logger.error("round_start_result_delivery_failed")
                }
            }
        }

        private func presentRewardedAd(_ request: GameRewardedAdRequest, webView: WKWebView?) {
            guard rewardedRequestLedger.begin(requestID: request.requestID) else {
                Self.logger.debug("rewarded_ad_ignored reason=duplicate_request")
                return
            }
            Self.logger.notice(
                "rewarded_ad_presentation_started source=\(request.source, privacy: .public) placement=\(request.placement, privacy: .public)"
            )

            Task { @MainActor [weak self, weak webView] in
                let result = await RewardedAdCoordinator.shared.present(request: request)
                guard let self,
                      self.rewardedRequestLedger.complete(requestID: request.requestID) else {
                    return
                }
                self.sendRewardedAdResult(result, to: webView)
            }
        }

        private func rejectRewardedRequestIfAddressable(
            _ body: [String: Any],
            webView: WKWebView?,
            status: GameRewardedAdResult.Status,
            errorCode: String
        ) {
            guard let address = GameRewardedAdRequest.address(from: body) else {
                reportBridgeFailure(reason: errorCode)
                return
            }
            Self.logger.error(
                "rewarded_ad_rejected reason=\(errorCode, privacy: .public)"
            )
            deliverRewardedResultOnce(
                GameRewardedAdResult(
                    requestID: address.requestID,
                    sessionID: address.sessionID,
                    status: status,
                    errorCode: errorCode
                ),
                to: webView
            )
        }

        private func deliverRewardedResultOnce(_ result: GameRewardedAdResult, to webView: WKWebView?) {
            guard rewardedRequestLedger.begin(requestID: result.requestID),
                  rewardedRequestLedger.complete(requestID: result.requestID) else {
                Self.logger.debug("rewarded_ad_result_ignored reason=duplicate_request")
                return
            }
            sendRewardedAdResult(result, to: webView)
        }

        private func sendRewardedAdResult(_ result: GameRewardedAdResult, to webView: WKWebView?) {
            guard let webView else { return }
            Self.logger.notice(
                "rewarded_ad_terminal status=\(result.status.rawValue, privacy: .public) error=\(result.errorCode ?? "none", privacy: .public)"
            )
            webView.callAsyncJavaScript(
                GameRewardedAdJavaScript.callbackSource,
                arguments: ["result": result.javaScriptPayload],
                in: nil,
                in: .page
            ) { evaluation in
                if case .failure = evaluation {
                    Self.logger.error("rewarded_ad_result_delivery_failed")
                }
            }
        }

        private func routeToUserProfile(_ userID: String, transport: String) {
            let route = { [weak self] in
                guard let self else { return }
                guard self.profileOpenGate.shouldOpen(userID: userID) else {
                    Self.logger.debug("profile_route_ignored reason=debounced transport=\(transport, privacy: .public)")
                    return
                }

                guard self.parent.onOpenUserProfile(userID) else {
                    self.reportBridgeFailure(reason: "router_unavailable")
                    return
                }
                Self.logger.info("profile_route_opened transport=\(transport, privacy: .public)")
            }

            if Thread.isMainThread {
                route()
            } else {
                DispatchQueue.main.async(execute: route)
            }
        }

        private func reportBridgeFailure(reason: String) {
            Self.logger.error("game_bridge_rejected reason=\(reason, privacy: .public)")
            let showFailure: () -> Void = { [weak self] in
                guard let self else { return }
                self.parent.onBridgeFailure()
            }
            if Thread.isMainThread {
                showFailure()
            } else {
                DispatchQueue.main.async(execute: showFailure)
            }
        }

        private func decodeRoute(from value: Any?) -> DynamicRoute? {
            guard let value else { return nil }
            if let route = value as? [String: Any],
               JSONSerialization.isValidJSONObject(route),
               let data = try? JSONSerialization.data(withJSONObject: route) {
                return try? JSONDecoder().decode(DynamicRoute.self, from: data)
            }
            if let string = value as? String,
               let data = string.data(using: .utf8) {
                return try? JSONDecoder().decode(DynamicRoute.self, from: data)
            }
            return nil
        }

        private func sendAppInfo(to webView: WKWebView?) {
            let payload: [String: String] = [
                "appVersion": AppBuildInfo.appVersion,
                "build": "\(AppBuildInfo.buildNumber)",
                "platform": "iOS"
            ]
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else {
                return
            }
            webView?.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('BWChatAppInfo',{detail:\(json)}));"
            )
        }

        private func shouldOpenExternally(_ url: URL) -> Bool {
            guard let scheme = url.scheme?.lowercased() else { return false }
            if ["tel", "mailto", "sms", "facetime"].contains(scheme) {
                return true
            }
            if ["itms-apps", "itms-services"].contains(scheme) {
                return true
            }
            guard let host = url.host?.lowercased() else { return false }
            return host.matchesDynamicDomain("apps.apple.com") || host.matchesDynamicDomain("itunes.apple.com")
        }
    }
}

enum BridgeHandlerName {
    static let app = "bwchat"
    static let game = "bwchatGameBridge"
}

final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

struct GameBridgeMessage: Decodable, Equatable {
    let type: String
    let version: Int
    let source: String
    let userID: String
    let deepLink: String

    private enum CodingKeys: String, CodingKey {
        case type
        case version
        case source
        case userID = "user_id"
        case deepLink = "deep_link"
    }
}

enum GameBridgeValidationError: String, Error, Equatable {
    case invalidType = "invalid_type"
    case invalidVersion = "invalid_version"
    case invalidSource = "invalid_source"
    case invalidUserID = "invalid_user_id"
    case invalidDeepLink = "invalid_deep_link"
}

enum GameBridgeMessageValidator {
    static func decode(_ body: [String: Any]) throws -> GameBridgeMessage {
        guard let type = body["type"] as? String,
              type == "bwchat.game.open_user_profile" else {
            throw GameBridgeValidationError.invalidType
        }
        guard let version = body["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(),
              version.intValue == 1,
              version.doubleValue == 1 else {
            throw GameBridgeValidationError.invalidVersion
        }
        guard let source = body["source"] as? String,
              source == "just_clear" else {
            throw GameBridgeValidationError.invalidSource
        }
        guard let userID = body["user_id"] as? String,
              GameProfileRoute.isValidUserID(userID) else {
            throw GameBridgeValidationError.invalidUserID
        }
        guard let deepLink = body["deep_link"] as? String,
              deepLink == GameProfileRoute.deepLink(for: userID) else {
            throw GameBridgeValidationError.invalidDeepLink
        }

        return GameBridgeMessage(
            type: type,
            version: version.intValue,
            source: source,
            userID: userID,
            deepLink: deepLink
        )
    }
}

enum GameBridgeRoutingError: String, Error, Equatable {
    case unsupportedType = "unsupported_type"
}

enum GameBridgeAction: Equatable {
    case openUserProfile(GameBridgeMessage)
    case showRewardedAd(GameRewardedAdRequest)
    case requestRoundStart(GameRoundStartRequest)
}

enum GameBridgeRouter {
    static let profileType = "bwchat.game.open_user_profile"
    static let rewardedAdType = "bwchat.game.show_rewarded_ad"
    static let roundStartType = "bwchat.game.request_round_start"

    static func decode(_ body: [String: Any]) throws -> GameBridgeAction {
        guard let type = body["type"] as? String else {
            throw GameBridgeRoutingError.unsupportedType
        }
        switch type {
        case profileType:
            return .openUserProfile(try GameBridgeMessageValidator.decode(body))
        case rewardedAdType:
            return .showRewardedAd(try GameRewardedAdRequestValidator.decode(body))
        case roundStartType:
            return .requestRoundStart(try GameRoundStartRequestValidator.decode(body))
        default:
            throw GameBridgeRoutingError.unsupportedType
        }
    }
}

struct GameRoundStartRequest: Equatable {
    struct Address: Hashable {
        let requestID: String
        let sessionID: String
    }

    let type: String
    let version: Int
    let source: String
    let trigger: String
    let requestID: String
    let sessionID: String

    var idempotencyKey: UUID {
        // Construction is restricted to the strict UUIDv4 validator below.
        UUID(uuidString: requestID)!
    }

    var address: Address {
        Address(requestID: requestID, sessionID: sessionID)
    }

    static func address(from body: [String: Any]) -> Address? {
        guard let requestID = body["request_id"] as? String,
              let sessionID = body["session_id"] as? String,
              GameRewardedAdRequestValidator.isUUIDv4(requestID),
              GameRoundStartRequestValidator.isSessionID(sessionID) else {
            return nil
        }
        return Address(
            requestID: requestID.lowercased(),
            sessionID: sessionID
        )
    }
}

enum GameRoundStartValidationError: String, Error, Equatable {
    case invalidType = "invalid_type"
    case invalidVersion = "invalid_version"
    case invalidSource = "invalid_source"
    case invalidTrigger = "invalid_trigger"
    case invalidRequestID = "invalid_request_id"
    case invalidSessionID = "invalid_session_id"
}

enum GameRoundStartRequestValidator {
    private static let sessionIDScalars = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )

    static func decode(_ body: [String: Any]) throws -> GameRoundStartRequest {
        guard body["type"] as? String == GameBridgeRouter.roundStartType else {
            throw GameRoundStartValidationError.invalidType
        }
        guard let version = GameRewardedAdRequestValidator.strictInteger(body["version"]),
              version == 1 else {
            throw GameRoundStartValidationError.invalidVersion
        }
        guard let source = body["source"] as? String,
              GameRewardedAdRequestValidator.isSlug(source) else {
            throw GameRoundStartValidationError.invalidSource
        }
        guard let trigger = body["trigger"] as? String,
              GameRewardedAdRequestValidator.isSlug(trigger) else {
            throw GameRoundStartValidationError.invalidTrigger
        }
        guard let requestID = body["request_id"] as? String,
              GameRewardedAdRequestValidator.isUUIDv4(requestID) else {
            throw GameRoundStartValidationError.invalidRequestID
        }
        guard let sessionID = body["session_id"] as? String,
              isSessionID(sessionID) else {
            throw GameRoundStartValidationError.invalidSessionID
        }
        return GameRoundStartRequest(
            type: GameBridgeRouter.roundStartType,
            version: version,
            source: source,
            trigger: trigger,
            requestID: requestID.lowercased(),
            sessionID: sessionID
        )
    }

    /// Lobby sessions are server-issued opaque identifiers. Production uses a
    /// case-sensitive base64url token, while older environments use ULIDs.
    /// Keep the value byte-for-byte so the later native context comparison
    /// remains authoritative.
    static func isSessionID(_ value: String) -> Bool {
        let scalars = Array(value.unicodeScalars)
        guard (16...128).contains(scalars.count) else { return false }
        return scalars.allSatisfy(sessionIDScalars.contains)
    }
}

enum GameRoundStartErrorCode {
    static let invalidMessage = "native_invalid_message"
    static let untrustedGameOrigin = "native_untrusted_game_origin"
    static let contextMismatch = "native_game_context_mismatch"
    static let paymentAlreadyShowing = "native_payment_already_showing"
    static let paymentFailed = "native_payment_failed"
    static let resumeTokenFailure = "native_round_resume_token_failure"
    static let insufficientGoldCoins = "INSUFFICIENT_GOLD_COINS"
}

enum GameRoundStartFailureClassifier {
    private static let resumeTokenCodes = [
        "GAME_ROUND_TOKEN_INVALID",
        "GAME_ROUND_TOKEN_EXPIRED"
    ]

    static func isResumeTokenFailure(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        let candidates: [String]
        switch apiError {
        case .businessError(let code, let message, _):
            candidates = [code, message]
        case .serverError(_, let message):
            candidates = [message]
        default:
            return false
        }
        return candidates.contains { value in
            let normalized = value.uppercased()
            return resumeTokenCodes.contains { normalized.contains($0) }
        }
    }

    static func bridgeErrorCode(for error: Error) -> String? {
        guard let apiError = error as? APIError else { return nil }
        let candidates: [String]
        switch apiError {
        case .businessError(let code, let message, _):
            candidates = [code, message]
        case .serverError(_, let message):
            candidates = [message]
        default:
            return nil
        }
        if candidates.contains(where: {
            let normalized = $0.uppercased()
            return normalized.contains("INSUFFICIENT_GOLD_COINS")
                || $0.contains("金币余额不足")
        }) {
            return GameRoundStartErrorCode.insufficientGoldCoins
        }
        return nil
    }
}

struct GameRoundStartBridgeResult: Equatable {
    enum Status: String, Equatable {
        case started
        case cancelled
        case failed
    }

    let requestID: String
    let sessionID: String
    let status: Status
    let roundID: String?
    let roundToken: String?
    let expiresAt: String?
    let paymentMethod: String?
    let entryPriceGoldCoins: Int?
    let errorCode: String?

    var address: GameRoundStartRequest.Address {
        .init(requestID: requestID, sessionID: sessionID)
    }

    static func started(
        request: GameRoundStartRequest,
        round: GameRoundStart
    ) -> Self {
        Self(
            requestID: request.requestID,
            sessionID: request.sessionID,
            status: .started,
            roundID: round.roundID,
            roundToken: round.roundToken,
            expiresAt: round.expiresAt,
            paymentMethod: round.paymentMethod,
            entryPriceGoldCoins: round.entryPriceGoldCoins,
            errorCode: nil
        )
    }

    static func cancelled(request: GameRoundStartRequest) -> Self {
        Self(
            requestID: request.requestID,
            sessionID: request.sessionID,
            status: .cancelled,
            roundID: nil,
            roundToken: nil,
            expiresAt: nil,
            paymentMethod: nil,
            entryPriceGoldCoins: nil,
            errorCode: nil
        )
    }

    static func failed(
        request: GameRoundStartRequest,
        errorCode: String
    ) -> Self {
        failed(
            address: .init(
                requestID: request.requestID,
                sessionID: request.sessionID
            ),
            errorCode: errorCode
        )
    }

    static func failed(
        address: GameRoundStartRequest.Address,
        errorCode: String
    ) -> Self {
        Self(
            requestID: address.requestID,
            sessionID: address.sessionID,
            status: .failed,
            roundID: nil,
            roundToken: nil,
            expiresAt: nil,
            paymentMethod: nil,
            entryPriceGoldCoins: nil,
            errorCode: errorCode
        )
    }

    var javaScriptPayload: [String: Any] {
        var payload: [String: Any] = [
            "request_id": requestID,
            "session_id": sessionID,
            "status": status.rawValue
        ]
        if let roundID { payload["round_id"] = roundID }
        if let roundToken { payload["round_token"] = roundToken }
        if let expiresAt { payload["expires_at"] = expiresAt }
        if let paymentMethod { payload["payment_method"] = paymentMethod }
        if let entryPriceGoldCoins { payload["entry_price_gold_coins"] = entryPriceGoldCoins }
        if let errorCode { payload["error_code"] = errorCode }
        return payload
    }
}

enum GameRoundStartJavaScript {
    static let callbackSource = """
    window.dispatchEvent(new CustomEvent("bwchat:round-start-result", { detail: result }));
    if (typeof window.__bwchatRoundStartResult === "function") {
        window.__bwchatRoundStartResult(result);
    }
    window.postMessage(
        { type: "bwchat:round-start-result", payload: result },
        window.location.origin
    );
    return true;
    """
}

struct GameRoundStartRequestLedger {
    private var pendingRequests = Set<GameRoundStartRequest.Address>()
    private var completedRequests = Set<GameRoundStartRequest.Address>()

    mutating func begin(address: GameRoundStartRequest.Address) -> Bool {
        guard !pendingRequests.contains(address),
              !completedRequests.contains(address) else {
            return false
        }
        pendingRequests.insert(address)
        return true
    }

    mutating func complete(address: GameRoundStartRequest.Address) -> Bool {
        guard pendingRequests.remove(address) != nil,
              completedRequests.insert(address).inserted else {
            return false
        }
        return true
    }
}

struct GameRewardedAdRequest: Equatable {
    let type: String
    let version: Int
    let source: String
    let placement: String
    let requestID: String
    let sessionID: String
    let adUnitID: String
    let ssvUserID: String
    let ssvCustomData: String

    struct Address: Equatable {
        let requestID: String
        let sessionID: String
    }

    static func address(from body: [String: Any]) -> Address? {
        guard let requestID = body["request_id"] as? String,
              let sessionID = body["session_id"] as? String,
              GameRewardedAdRequestValidator.isUUIDv4(requestID),
              GameRewardedAdRequestValidator.isULID(sessionID) else {
            return nil
        }
        return Address(requestID: requestID.lowercased(), sessionID: sessionID.uppercased())
    }
}

enum GameRewardedAdValidationError: String, Error, Equatable {
    case invalidType = "invalid_type"
    case invalidVersion = "invalid_version"
    case invalidSource = "invalid_source"
    case invalidPlacement = "invalid_placement"
    case invalidRequestID = "invalid_request_id"
    case invalidSessionID = "invalid_session_id"
    case invalidAdUnitID = "invalid_ad_unit_id"
    case invalidSSVUserID = "invalid_ssv_user_id"
    case invalidSSVCustomData = "invalid_ssv_custom_data"
    case invalidRewardItem = "invalid_reward_item"
    case invalidRewardAmount = "invalid_reward_amount"
}

enum GameRewardedAdRequestValidator {
    private static let slugScalars = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789._-")
    private static let hexadecimalScalars = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
    private static let ulidScalars = CharacterSet(charactersIn: "0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    static func decode(_ body: [String: Any]) throws -> GameRewardedAdRequest {
        guard body["type"] as? String == GameBridgeRouter.rewardedAdType else {
            throw GameRewardedAdValidationError.invalidType
        }
        guard let version = strictInteger(body["version"]), version == 1 else {
            throw GameRewardedAdValidationError.invalidVersion
        }
        guard let source = body["source"] as? String, isSlug(source) else {
            throw GameRewardedAdValidationError.invalidSource
        }
        guard let placement = body["placement"] as? String, isSlug(placement) else {
            throw GameRewardedAdValidationError.invalidPlacement
        }
        guard let requestID = body["request_id"] as? String, isUUIDv4(requestID) else {
            throw GameRewardedAdValidationError.invalidRequestID
        }
        guard let sessionID = body["session_id"] as? String, isULID(sessionID) else {
            throw GameRewardedAdValidationError.invalidSessionID
        }
        guard let adUnitID = body["ad_unit_id"] as? String,
              isBoundedText(adUnitID, maximumLength: 128) else {
            throw GameRewardedAdValidationError.invalidAdUnitID
        }
        guard let ssvUserID = body["ssv_user_id"] as? String,
              isBoundedText(ssvUserID, maximumLength: 256) else {
            throw GameRewardedAdValidationError.invalidSSVUserID
        }
        guard let ssvCustomData = body["ssv_custom_data"] as? String,
              isBoundedText(ssvCustomData, maximumLength: 2_048) else {
            throw GameRewardedAdValidationError.invalidSSVCustomData
        }

        // These legacy protocol fields are validation-only. A hosted game may
        // use the earned result to claim a server-verified game effect (such as
        // revive), but native code must never carry this metadata into the
        // wallet reward path.
        if let value = body["reward_item"] {
            guard let string = value as? String,
                  isBoundedText(string, maximumLength: 128) else {
                throw GameRewardedAdValidationError.invalidRewardItem
            }
        }

        guard let rewardAmount = strictInteger(body["reward_amount"]),
              rewardAmount > 0 else {
            throw GameRewardedAdValidationError.invalidRewardAmount
        }

        return GameRewardedAdRequest(
            type: GameBridgeRouter.rewardedAdType,
            version: version,
            source: source,
            placement: placement,
            requestID: requestID.lowercased(),
            sessionID: sessionID.uppercased(),
            adUnitID: adUnitID,
            ssvUserID: ssvUserID,
            ssvCustomData: ssvCustomData
        )
    }

    static func isSlug(_ value: String) -> Bool {
        guard (1...64).contains(value.count) else { return false }
        return value.unicodeScalars.allSatisfy(slugScalars.contains)
    }

    static func isUUIDv4(_ value: String) -> Bool {
        let scalars = Array(value.unicodeScalars)
        guard scalars.count == 36,
              scalars[8] == "-",
              scalars[13] == "-",
              scalars[18] == "-",
              scalars[23] == "-",
              scalars[14] == "4",
              "89abAB".unicodeScalars.contains(scalars[19]) else {
            return false
        }
        for (index, scalar) in scalars.enumerated() where ![8, 13, 18, 23].contains(index) {
            guard hexadecimalScalars.contains(scalar) else { return false }
        }
        return UUID(uuidString: value) != nil
    }

    static func isULID(_ value: String) -> Bool {
        let normalized = value.uppercased()
        let scalars = Array(normalized.unicodeScalars)
        guard scalars.count == 26,
              "01234567".unicodeScalars.contains(scalars[0]) else {
            return false
        }
        return scalars.allSatisfy(ulidScalars.contains)
    }

    static func strictInteger(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else {
            return nil
        }
        let double = number.doubleValue
        guard double.isFinite,
              double.rounded(.towardZero) == double,
              double >= Double(Int.min),
              double <= Double(Int.max) else {
            return nil
        }
        return Int(double)
    }

    private static func isBoundedText(_ value: String, maximumLength: Int) -> Bool {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.count <= maximumLength else {
            return false
        }
        return !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
}

enum GameRewardedAdErrorCode {
    static let alreadyShowing = "native_ad_already_showing"
    static let adUnitNotAllowed = "native_ad_unit_not_allowed"
    static let invalidMessage = "native_invalid_message"
    static let untrustedGameOrigin = "native_untrusted_game_origin"
    static let sdkNotInitialized = "native_sdk_not_initialized"
    static let loadFailed = "native_ad_load_failed"
    static let noFill = "native_ad_no_fill"
    static let presentFailed = "native_ad_present_failed"
    static let presenterUnavailable = "native_presenter_unavailable"
}

enum GameRewardedAdJavaScript {
    /// Result data is supplied through `callAsyncJavaScript(arguments:)`; no
    /// request-controlled value is ever interpolated into executable source.
    static let callbackSource = """
    window.dispatchEvent(new CustomEvent("bwchat:rewarded-ad-result", { detail: result }));
    if (typeof window.__bwchatRewardedAdResult === "function") {
        window.__bwchatRewardedAdResult(result);
    }
    window.postMessage(
        { type: "bwchat:rewarded-ad-result", payload: result },
        window.location.origin
    );
    return true;
    """
}

struct GameRewardedAdResult: Equatable {
    enum Status: String, Equatable {
        case completed
        case dismissed
        case failed
        case unavailable
    }

    let requestID: String
    let sessionID: String
    let status: Status
    var errorCode: String?

    init(requestID: String, sessionID: String, status: Status, errorCode: String? = nil) {
        self.requestID = requestID
        self.sessionID = sessionID
        self.status = status
        self.errorCode = errorCode
    }

    var javaScriptPayload: [String: Any] {
        var payload: [String: Any] = [
            "request_id": requestID,
            "session_id": sessionID,
            "status": status.rawValue
        ]
        if let errorCode {
            payload["error_code"] = errorCode
        }
        return payload
    }
}

struct GameRewardedAdRequestLedger {
    private var pendingRequestIDs = Set<String>()
    private var completedRequestIDs = Set<String>()

    mutating func begin(requestID: String) -> Bool {
        guard !pendingRequestIDs.contains(requestID),
              !completedRequestIDs.contains(requestID) else {
            return false
        }
        pendingRequestIDs.insert(requestID)
        return true
    }

    mutating func complete(requestID: String) -> Bool {
        guard pendingRequestIDs.remove(requestID) != nil,
              completedRequestIDs.insert(requestID).inserted else {
            return false
        }
        return true
    }
}

enum GameRewardedAdUnitAllowlist {
    @MainActor
    static var currentAdUnitIDs: [String] {
        let configured = RewardedAdUnitResolver.normalizedIDs(
            AppRemoteConfigStore.shared.config.wallet?.adReward?.iosAdUnitIDs
        )
        return configured.isEmpty
            ? AdMobConfiguration.bundledGameRewardedAdUnitIDs
            : configured
    }

    @MainActor
    static func currentAllows(_ adUnitID: String) -> Bool {
        currentAdUnitIDs.contains(adUnitID)
    }

    static func allows(_ adUnitID: String, configuredIDs: [String]?) -> Bool {
        effectiveIDs(configuredIDs: configuredIDs).contains(adUnitID)
    }

    private static func effectiveIDs(configuredIDs: [String]?) -> Set<String> {
        let configured = normalizedIDs(configuredIDs ?? [])
        return configured.isEmpty
            ? Set(AdMobConfiguration.bundledGameRewardedAdUnitIDs)
            : configured
    }

    private static func normalizedIDs(_ values: [String]) -> Set<String> {
        Set(RewardedAdUnitResolver.normalizedIDs(values))
    }
}

enum GameProfileRoute {
    static let scheme = "bwchat"
    private static let host = "profile"
    private static let maximumUserIDLength = 128
    private static let userIDScalars = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
    )
    private static let deepLinkPathScalars = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )

    static func isValidUserID(_ userID: String) -> Bool {
        guard !userID.isEmpty, userID.count <= maximumUserIDLength else { return false }
        return userID.unicodeScalars.allSatisfy(userIDScalars.contains)
    }

    static func deepLink(for userID: String) -> String? {
        guard isValidUserID(userID),
              let encodedUserID = userID.addingPercentEncoding(withAllowedCharacters: deepLinkPathScalars) else {
            return nil
        }
        return "\(scheme)://\(host)/\(encodedUserID)"
    }

    static func userID(fromFallbackURL url: URL) -> String? {
        guard url.scheme?.lowercased() == scheme,
              url.host?.lowercased() == host,
              url.user == nil,
              url.password == nil,
              url.port == nil,
              url.query == nil,
              url.fragment == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }

        let percentEncodedPath = components.percentEncodedPath
        guard percentEncodedPath.first == "/",
              percentEncodedPath.count > 1 else {
            return nil
        }

        let encodedUserID = String(percentEncodedPath.dropFirst())
        guard !encodedUserID.contains("/"),
              let userID = encodedUserID.removingPercentEncoding,
              isValidUserID(userID) else {
            return nil
        }
        return userID
    }
}

struct GameProfileOpenGate {
    static let debounceInterval: TimeInterval = 0.6

    private var lastUserID: String?
    private var lastOpenDate = Date.distantPast

    mutating func shouldOpen(userID: String, now: Date = Date()) -> Bool {
        if lastUserID == userID,
           now.timeIntervalSince(lastOpenDate) < Self.debounceInterval {
            return false
        }
        lastUserID = userID
        lastOpenDate = now
        return true
    }
}

/// Keeps one warm game web view so opening a game does not repeatedly pay the
/// WebContent-process and JavaScript-engine cold-start cost. The visible
/// document is detached before recycling, while cookies, localStorage and the
/// HTTP cache remain in the shared persistent website data store.
@MainActor
final class GameWebViewPool {
    static let shared = GameWebViewPool()
    static let persistentWebsiteDataStore = WKWebsiteDataStore.default()

    private var cachedWebView: WKWebView?

    private init() {}

    func prewarm() {
        guard cachedWebView == nil else { return }
        let webView = Self.makeWebView()
        webView.loadHTMLString(Self.blankDocument, baseURL: nil)
        cachedWebView = webView
    }

    func acquire() -> WKWebView {
        if let cachedWebView {
            self.cachedWebView = nil
            return cachedWebView
        }
        return Self.makeWebView()
    }

    func recycle(_ webView: WKWebView) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        // Navigating away stops game timers/audio. It does not remove website
        // data; the next lobby can resume an unfinished round using the same
        // HttpOnly cookies and origin-scoped localStorage.
        webView.loadHTMLString(Self.blankDocument, baseURL: nil)

        guard cachedWebView == nil else { return }
        cachedWebView = webView
    }

    static func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = persistentWebsiteDataStore
        configuration.userContentController = WKUserContentController()
        configuration.allowsInlineMediaPlayback = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        return WKWebView(frame: .zero, configuration: configuration)
    }

    private static let blankDocument = """
    <!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body></body></html>
    """
}

enum GameWebSecurity {
    private static let gameAssetsPath = "/api/v1/game-assets/"

    static func allowsInitialGameURL(
        _ url: URL,
        policy: WebViewPolicy = .default
    ) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host != nil,
              url.user == nil,
              url.password == nil,
              policy.allows(url) else {
            return false
        }
        return url.standardized.path.hasPrefix(gameAssetsPath)
    }

    static func isSameOrigin(_ candidate: URL, as initialURL: URL) -> Bool {
        guard let candidateScheme = candidate.scheme?.lowercased(),
              let initialScheme = initialURL.scheme?.lowercased(),
              let candidateHost = candidate.host?.lowercased(),
              let initialHost = initialURL.host?.lowercased() else {
            return false
        }
        return candidateScheme == initialScheme
            && candidateHost == initialHost
            && effectivePort(candidate) == effectivePort(initialURL)
    }

    static func isWebURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    /// Hosted games and their native bridges are HTTPS-only. The optional
    /// argument remains for source compatibility with older test fixtures.
    static func rewardedBridgeRequiresHTTPS(
        for initialURL: URL,
        configuredBackendScheme: String? = nil
    ) -> Bool {
        _ = initialURL
        _ = configuredBackendScheme
        return true
    }

    static func allowsGameBridgeMessage(
        isMainFrame: Bool = true,
        from sourceURL: URL?,
        initialURL: URL,
        requiresHTTPS: Bool,
        policy: WebViewPolicy = .default
    ) -> Bool {
        allowsGameBridgeMessage(
            isMainFrame: isMainFrame,
            currentURL: sourceURL,
            frameURL: sourceURL,
            initialURL: initialURL,
            requiresHTTPS: requiresHTTPS,
            policy: policy
        )
    }

    static func allowsGameBridgeMessage(
        isMainFrame: Bool,
        currentURL: URL?,
        frameURL: URL?,
        initialURL: URL,
        requiresHTTPS: Bool,
        policy: WebViewPolicy = .default
    ) -> Bool {
        guard isMainFrame,
              let currentURL,
              let frameURL,
              allowsInitialGameURL(currentURL, policy: policy),
              allowsInitialGameURL(frameURL, policy: policy),
              isSameOrigin(currentURL, as: initialURL),
              isSameOrigin(frameURL, as: initialURL) else {
            return false
        }
        return !requiresHTTPS
            || (
                currentURL.scheme?.lowercased() == "https"
                    && frameURL.scheme?.lowercased() == "https"
            )
    }

    static func navigationResolution(
        for candidate: URL,
        initialURL: URL
    ) -> GameWebNavigationResolution {
        if let userID = GameProfileRoute.userID(fromFallbackURL: candidate) {
            return .openUserProfile(userID)
        }
        guard isWebURL(candidate), isSameOrigin(candidate, as: initialURL) else {
            return .cancel
        }
        return .allow
    }

    private static func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }
}

enum GameNavigationFailurePolicy {
    static func shouldShowBlockingError(hasFinishedInitialDocument: Bool) -> Bool {
        !hasFinishedInitialDocument
    }
}

enum GameWebNavigationResolution: Equatable {
    case allow
    case openUserProfile(String)
    case cancel
}
