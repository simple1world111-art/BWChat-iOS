// BWChat/Utils/Extensions.swift
// Swift type extensions

import SwiftUI
import UIKit

// MARK: - View Extensions

extension View {
    /// Hide keyboard
    func hideKeyboard() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil, from: nil, for: nil
        )
    }

    /// Conditional modifier
    @ViewBuilder
    func `if`<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }

    /// Long-press to show a "保存到相册 / 取消" confirmation before saving media.
    /// Uses .simultaneousGesture so it coexists with ancestor DragGestures
    /// (e.g. swipe-to-reply on MessageBubble) without being swallowed.
    func longPressToSaveImage(url: String) -> some View {
        modifier(LongPressSaveMediaModifier(url: url, kind: .image))
    }

    func longPressToSaveVideo(url: String) -> some View {
        modifier(LongPressSaveMediaModifier(url: url, kind: .video))
    }
}

private struct LongPressSaveMediaModifier: ViewModifier {
    enum Kind { case image, video }
    let url: String
    let kind: Kind
    @State private var showConfirmation = false

    func body(content: Content) -> some View {
        content
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5)
                    .onEnded { _ in
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        showConfirmation = true
                    }
            )
            .confirmationDialog("", isPresented: $showConfirmation, titleVisibility: .hidden) {
                Button(kind == .image ? "保存图片到相册" : "保存视频到相册") {
                    let u = url
                    Task {
                        switch kind {
                        case .image: await MediaLibrarySaver.saveImage(mediaPath: u)
                        case .video: await MediaLibrarySaver.saveVideo(mediaPath: u)
                        }
                    }
                }
                Button("取消", role: .cancel) {}
            }
    }
}

// MARK: - String Extensions

extension String {
    var isBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Date Extensions

extension Date {
    var iso8601String: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: self)
    }
}

// MARK: - Timestamp Grouping

enum TimestampHelper {
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoFormatterNoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ string: String) -> Date? {
        isoFormatter.date(from: string) ?? isoFormatterNoFrac.date(from: string)
    }

    static func formatSeparator(_ string: String) -> String {
        guard let date = parse(string) else { return "" }
        let cal = Calendar.current
        let tf = DateFormatter()
        if cal.isDateInToday(date) {
            tf.dateFormat = "HH:mm"
        } else if cal.isDateInYesterday(date) {
            tf.dateFormat = "'昨天' HH:mm"
        } else if cal.component(.year, from: date) == cal.component(.year, from: Date()) {
            tf.dateFormat = "M月d日 HH:mm"
        } else {
            tf.dateFormat = "yyyy年M月d日 HH:mm"
        }
        return tf.string(from: date)
    }

    static func shouldShowTime(current: String, previous: String?) -> Bool {
        guard let prev = previous, let curDate = parse(current), let prevDate = parse(prev) else {
            return true
        }
        return curDate.timeIntervalSince(prevDate) >= 120
    }
}

// MARK: - Data Extensions

extension Data {
    /// Convert to hex string (for device token)
    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Tab Bar Hide During Push

extension View {
    /// Hide the enclosing UITabBar while this view is visible on a
    /// NavigationStack — the bar slides off during push and back during
    /// pop, in sync with the transition. Bridges to UIKit:
    ///   - find the UITabBar via the parent chain
    ///   - apply a CGAffineTransform translation
    ///   - animate alongside the current transitionCoordinator
    ///
    /// Why not `.toolbar(.hidden, for: .tabBar)`? That modifier flickers
    /// on push/pop in iOS 16 — SwiftUI re-evaluates the toolbar state
    /// mid-transition and the tab bar reappears briefly at animation
    /// end. Driving the tab bar directly through UIKit avoids that
    /// because it's the same mechanism UINavigationController uses
    /// when `hidesBottomBarWhenPushed` is set: a single continuous
    /// animation on the bar's transform.
    func hidesTabBarOnPush() -> some View {
        background(TabBarHidingBridge())
    }
}

private struct TabBarHidingBridge: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> TabBarHidingController { TabBarHidingController() }
    func updateUIViewController(_ uiViewController: TabBarHidingController, context: Context) {}
}

private final class TabBarHidingController: UIViewController {
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        setTabBar(hidden: true, animated: animated)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Only reveal on actual pop (hosting VC being removed from its
        // UINavigationController); a push covering us means another
        // detail view is appearing and the bar should stay hidden.
        guard let host = hostingAncestor(), host.isMovingFromParent else { return }
        setTabBar(hidden: false, animated: animated)
    }

    /// Find the UIHostingController that's a direct child of the
    /// NavigationStack's underlying UINavigationController — that's
    /// the VC being pushed / popped.
    private func hostingAncestor() -> UIViewController? {
        var vc: UIViewController? = parent
        while let current = vc {
            if current.parent is UINavigationController { return current }
            vc = current.parent
        }
        return nil
    }

    private func tabBar() -> UITabBar? {
        var vc: UIViewController? = parent
        while let current = vc {
            if let tbc = current.tabBarController { return tbc.tabBar }
            vc = current.parent
        }
        return nil
    }

    private func transitionCoordinator_() -> UIViewControllerTransitionCoordinator? {
        var vc: UIViewController? = parent
        while let current = vc {
            if let coord = current.transitionCoordinator { return coord }
            vc = current.parent
        }
        return nil
    }

    private func setTabBar(hidden: Bool, animated: Bool) {
        guard let tabBar = tabBar() else { return }
        let height = tabBar.bounds.height
        // Using a transform (not frame) keeps UIKit's own layout pass
        // from resetting our change; the bar is visually translated
        // down but its "real" frame is untouched.
        let targetTransform: CGAffineTransform = hidden
            ? CGAffineTransform(translationX: 0, y: height)
            : .identity

        if animated, let coord = transitionCoordinator_() {
            coord.animate(alongsideTransition: { _ in
                tabBar.transform = targetTransform
            })
        } else {
            tabBar.transform = targetTransform
        }
    }
}

