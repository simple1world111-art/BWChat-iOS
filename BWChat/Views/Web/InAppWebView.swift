import SwiftUI
import WebKit

struct InAppWebView: View {
    let url: URL
    let restrictToInitialOrigin: Bool

    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var remoteConfig = AppRemoteConfigStore.shared
    @State private var pageTitle: String
    @State private var isLoading = true
    @State private var blockedMessage: String?
    @State private var routeAlert: DynamicRouteAlert?
    @State private var reloadID = UUID()

    init(url: URL, title: String, restrictToInitialOrigin: Bool = false) {
        self.url = url
        self.restrictToInitialOrigin = restrictToInitialOrigin
        self._pageTitle = State(initialValue: title)
    }

    var body: some View {
        ZStack {
            if let blockedMessage {
                blockedState(blockedMessage)
            } else if initialURLIsAllowed {
                HardenedWebViewRepresentable(
                    url: url,
                    policy: remoteConfig.config.webViewPolicy,
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
        }
        .navigationTitle(pageTitle)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .alert(item: $routeAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text(L10n.tr("common.ok")))
            )
        }
    }

    private var initialURLIsAllowed: Bool {
        remoteConfig.config.webViewPolicy.allows(url)
            || (restrictToInitialOrigin && GameWebSecurity.allowsInitialGameURL(url))
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

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "bwchat")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContentController
        configuration.allowsInlineMediaPlayback = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "bwchat")
        uiView.loadHTMLString("", baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private var parent: HardenedWebViewRepresentable

        init(_ parent: HardenedWebViewRepresentable) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.blockedMessage = error.localizedDescription
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.blockedMessage = error.localizedDescription
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
                guard GameWebSecurity.isSameOrigin(nextURL, as: parent.url) else {
                    decisionHandler(.cancel)
                    return
                }
                decisionHandler(.allow)
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
            guard message.name == "bwchat",
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

enum GameWebSecurity {
    private static var backendHost: String? {
        URL(string: AppConfig.apiBaseURL)?.host?.lowercased()
    }
    private static let gameAssetsPath = "/api/v1/game-assets/"

    static func allowsInitialGameURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host?.lowercased() == backendHost else {
            return false
        }
        return url.path.hasPrefix(gameAssetsPath)
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

    private static func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }
}
