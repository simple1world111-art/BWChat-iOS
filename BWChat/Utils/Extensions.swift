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
    /// NavigationStack. Uses SwiftUI's native modifier — it correctly
    /// updates safe-area insets so content fills the tab bar's slot
    /// (no blank strip). Also sets UIKit's hidesBottomBarWhenPushed on
    /// the hosting controller as a parallel path, in case the SwiftUI
    /// modifier's timing behaves differently on a given iOS version.
    func hidesTabBarOnPush() -> some View {
        self
            .toolbar(.hidden, for: .tabBar)
            .background(HidesTabBarUIKitBridge())
    }
}

private struct HidesTabBarUIKitBridge: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> BridgeController { BridgeController() }
    func updateUIViewController(_ uiViewController: BridgeController, context: Context) {}
}

private final class BridgeController: UIViewController {
    override func willMove(toParent parent: UIViewController?) {
        super.willMove(toParent: parent)
        guard let parent else { return }
        var vc: UIViewController? = parent
        while let current = vc {
            if String(describing: type(of: current)).contains("HostingController") {
                current.hidesBottomBarWhenPushed = true
            }
            vc = current.parent
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // The hide is handled correctly by `.toolbar(.hidden, for: .tabBar)`
        // but SwiftUI snaps the bar back IN at the end of the pop
        // transition instead of sliding it in during the transition.
        // Smooth that by driving the slide ourselves: on pop, pre-position
        // the tab bar below the screen and animate it to identity
        // alongside the current transition coordinator. The animation
        // ends exactly when SwiftUI makes the bar visible, so the snap
        // becomes a slide.
        guard isBeingPopped() else { return }
        guard let tabBar = findTabBar() else { return }
        guard let coord = findTransitionCoordinator() else { return }

        let height = tabBar.frame.height
        tabBar.transform = CGAffineTransform(translationX: 0, y: height)
        coord.animate(alongsideTransition: { _ in
            tabBar.transform = .identity
        }, completion: { _ in
            tabBar.transform = .identity
        })
    }

    private func isBeingPopped() -> Bool {
        var vc: UIViewController? = self
        while let current = vc {
            if current.isMovingFromParent || current.isBeingDismissed { return true }
            vc = current.parent
        }
        return false
    }

    private func findTabBar() -> UITabBar? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            for window in scene.windows {
                if let root = window.rootViewController, let bar = Self.locate(in: root) {
                    return bar
                }
            }
        }
        return nil
    }

    private static func locate(in vc: UIViewController) -> UITabBar? {
        if let tbc = vc as? UITabBarController { return tbc.tabBar }
        for child in vc.children {
            if let found = locate(in: child) { return found }
        }
        if let presented = vc.presentedViewController {
            return locate(in: presented)
        }
        return nil
    }

    private func findTransitionCoordinator() -> UIViewControllerTransitionCoordinator? {
        var vc: UIViewController? = self
        while let current = vc {
            if let coord = current.transitionCoordinator { return coord }
            vc = current.parent
        }
        return nil
    }
}

