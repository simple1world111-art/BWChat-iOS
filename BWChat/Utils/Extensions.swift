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

/// Global ref-counted tab-bar visibility. Each detail view's hosting
/// bridge increments on appear and decrements on disappear; the bar is
/// hidden exactly when count > 0. This sidesteps the need to detect
/// "am I being popped vs covered?" — push, pop, tab-switch, and
/// repeated appear/disappear all balance out arithmetically because
/// every vWA is paired with a vWD over a VC instance's lifetime, and
/// isCounted keeps it 1:1 per instance.
@MainActor
private final class TabBarState {
    static let shared = TabBarState()
    private var count = 0

    func increment() { count += 1 }
    func decrement() { count = max(0, count - 1) }

    func apply(coord: UIViewControllerTransitionCoordinator?) {
        guard let tabBar = Self.findTabBar() else { return }
        let hidden = count > 0
        // Fall back to 49pt (standard tab bar height) if bounds.height
        // is 0 in some lifecycle corner — otherwise translation(0, 0)
        // would equal identity and the "hide" would silently no-op.
        let height = max(tabBar.bounds.height, 49)
        let target: CGAffineTransform = hidden
            ? CGAffineTransform(translationX: 0, y: height)
            : .identity
        guard tabBar.transform != target else { return }

        if let coord {
            coord.animate(alongsideTransition: { _ in
                tabBar.transform = target
            })
        } else {
            tabBar.transform = target
        }
    }

    /// Current tab bar's rendered height (or 49pt fallback). Used by the
    /// detail-view hosting controller to cancel the tab bar's safe-area
    /// contribution when hiding, so chat content (input bar, list) can
    /// extend into the tab bar's former slot.
    func tabBarHeight() -> CGFloat {
        max(Self.findTabBar()?.bounds.height ?? 49, 49)
    }

    // Walk the application's window tree to find the UITabBar. Works
    // even if the caller's VC ancestor chain has detached during a
    // disappear.
    static func findTabBar() -> UITabBar? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            for window in scene.windows {
                if let root = window.rootViewController, let bar = locate(in: root) {
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
}

private final class TabBarHidingController: UIViewController {
    private var isCounted = false

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !isCounted {
            isCounted = true
            TabBarState.shared.increment()
        }
        let coord = transitionCoordinator_()
        TabBarState.shared.apply(coord: coord)
        // Cancel the tab bar's safe-area contribution on this detail
        // view's hosting controller so its SwiftUI content (input bar,
        // message list) extends into the space the tab bar used to
        // occupy. Without this there's an empty strip under the input
        // bar equal to the tab bar's height.
        adjustHostInset(cancelingTabBar: true, coord: coord)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isCounted {
            isCounted = false
            TabBarState.shared.decrement()
        }
        // Apply AFTER decrementing: on pop-to-root the count reaches 0
        // and the bar re-shows alongside the pop animation. On
        // push-cover the new VC's viewWillAppear re-increments
        // alongside the same transition and the net target stays
        // hidden (last-set wins in alongsideTransition animations).
        let coord = transitionCoordinator_()
        TabBarState.shared.apply(coord: coord)
        adjustHostInset(cancelingTabBar: false, coord: coord)
    }

    // Safety net: if a VC is torn down without a viewWillDisappear
    // (shouldn't happen, but defend against SwiftUI weirdness).
    deinit {
        if isCounted {
            Task { @MainActor in
                TabBarState.shared.decrement()
                TabBarState.shared.apply(coord: nil)
            }
        }
    }

    private func transitionCoordinator_() -> UIViewControllerTransitionCoordinator? {
        var vc: UIViewController? = parent
        while let current = vc {
            if let coord = current.transitionCoordinator { return coord }
            vc = current.parent
        }
        return nil
    }

    private func hostingControllerAncestor() -> UIViewController? {
        var vc: UIViewController? = parent
        while let current = vc {
            // Match both UIHostingController and any subclass by name —
            // SwiftUI uses generic UIHostingController<ContentView>
            // whose exact type varies per-view.
            if String(describing: type(of: current)).contains("HostingController") {
                return current
            }
            vc = current.parent
        }
        return nil
    }

    private func adjustHostInset(cancelingTabBar: Bool, coord: UIViewControllerTransitionCoordinator?) {
        guard let host = hostingControllerAncestor() else { return }
        let target: CGFloat = cancelingTabBar ? -TabBarState.shared.tabBarHeight() : 0
        guard host.additionalSafeAreaInsets.bottom != target else { return }

        if let coord {
            coord.animate(alongsideTransition: { _ in
                host.additionalSafeAreaInsets.bottom = target
                host.view.setNeedsLayout()
                host.view.layoutIfNeeded()
            })
        } else {
            host.additionalSafeAreaInsets.bottom = target
        }
    }
}

