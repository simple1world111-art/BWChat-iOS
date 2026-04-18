import SwiftUI
import WebKit

struct DiscoverView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var momentsNotif = MomentsNotificationManager.shared

    var body: some View {
        List {
            Button {
                momentsNotif.markFeedViewed()
                navigator.push(MomentsView())
            } label: {
                HStack(spacing: 14) {
                    ZStack(alignment: .topTrailing) {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(LinearGradient(
                                colors: [Color(hex: "667eea"), Color(hex: "764ba2")],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ))
                            .frame(width: 40, height: 40)
                        Image(systemName: "camera.fill")
                            .font(.system(size: 17))
                            .foregroundColor(.white)
                            .frame(width: 40, height: 40)

                        if momentsNotif.hasNewMoments {
                            Circle()
                                .fill(Color.red)
                                .frame(width: 10, height: 10)
                                .offset(x: 3, y: -3)
                        }
                    }

                    Text("朋友圈")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.primaryText)

                    Spacer()

                    if momentsNotif.unreadCount > 0 {
                        Text("\(momentsNotif.unreadCount)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(Color.red)
                            .cornerRadius(10)
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.tertiaryText)
                }
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowSeparator(.hidden)

            Button {
                navigator.push(InAppWebView(url: URL(string: "https://g123.jp")!, title: "游戏"))
            } label: {
                HStack(spacing: 14) {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(LinearGradient(
                            colors: [Color(hex: "FF6B6B"), Color(hex: "FF8E53")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Image(systemName: "gamecontroller.fill")
                                .font(.system(size: 17))
                                .foregroundColor(.white)
                        )

                    Text("游戏")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.primaryText)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.tertiaryText)
                }
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowSeparator(.hidden)
        }
        .listStyle(.plain)
        .background(AppColors.secondaryBackground)
        .navigationTitle("发现")
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await momentsNotif.fetchFromServer()
        }
    }
}

// MARK: - In-App WebView

struct InAppWebView: View {
    let url: URL
    let title: String
    @State private var isLoading = true

    var body: some View {
        ZStack {
            WebViewRepresentable(url: url, isLoading: $isLoading)
                .ignoresSafeArea(edges: .bottom)

            if isLoading {
                ProgressView()
                    .tint(AppColors.accent)
                    .scaleEffect(1.2)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
    }
}

struct WebViewRepresentable: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WebViewRepresentable

        init(_ parent: WebViewRepresentable) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }
    }
}

@MainActor
class MomentsNotificationManager: ObservableObject {
    static let shared = MomentsNotificationManager()
    @Published var unreadCount: Int = 0
    @Published var hasNewMoments: Bool = false

    func fetchFromServer() async {
        do {
            let info = try await APIService.shared.getMomentsUnreadInfo()
            if unreadCount != info.unreadCount { unreadCount = info.unreadCount }
            if hasNewMoments != info.hasNewMoments { hasNewMoments = info.hasNewMoments }
        } catch { }
    }

    func incrementBadge() {
        unreadCount += 1
    }

    func markFeedViewed() {
        hasNewMoments = false
        Task {
            try? await APIService.shared.markMomentsFeedViewed()
        }
    }

    func clearInteractionBadge() {
        unreadCount = 0
        Task {
            try? await APIService.shared.markMomentsNotificationsRead()
        }
    }
}
