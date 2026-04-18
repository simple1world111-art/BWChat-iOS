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
    /// NavigationStack. Two pieces working independently (neither
    /// fighting the other):
    ///
    ///   1. `.ignoresSafeArea(.container, edges: .bottom)` tells
    ///      SwiftUI the content should extend past the tab bar's
    ///      safe-area contribution. `.container` excludes the
    ///      device-level safe area (home indicator), so the chat
    ///      input bar sits just above the home indicator — no blank
    ///      strip below it.
    ///   2. A UIKit bridge animates UITabBar's transform alongside
    ///      the push/pop transition. Without SwiftUI's
    ///      `.toolbar(.hidden, for: .tabBar)` in the mix, SwiftUI
    ///      never writes isHidden/alpha on the bar, so our transform
    ///      animation actually renders — bar slides down during
    ///      push, up during pop.
    ///
    /// The mistake in earlier attempts: using `.toolbar(.hidden,
    /// for: .tabBar)` to handle safe-area AND expecting a custom
    /// animation to work. SwiftUI's modifier also takes over the
    /// bar's visibility per-frame, masking our animation. Separating
    /// the two concerns lets each mechanism do its one job cleanly.
    func hidesTabBarOnPush() -> some View {
        self
            // Small breathing room so the input bar doesn't sit right on
            // top of the home indicator. Applied BEFORE ignoresSafeArea
            // so the padding lands inside the extended content area.
            .padding(.bottom, 8)
            .ignoresSafeArea(.container, edges: .bottom)
            .background(HidesTabBarBridge())
    }
}

private struct HidesTabBarBridge: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> BridgeController { BridgeController() }
    func updateUIViewController(_ uiViewController: BridgeController, context: Context) {}
}

private final class BridgeController: UIViewController {
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // On push: slide the bar off. Also runs when we re-appear
        // after a sub-push is popped — idempotent since we animate
        // to the same offscreen target.
        animateTabBar(slidingOff: true)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Always schedule "slide back on" alongside the transition.
        // For push-cover (another detail pushed on top of us), the new
        // detail's viewWillAppear schedules "slide off" on the same
        // transition coordinator — alongsideTransition composes and
        // the last-set transform wins, so net effect is bar stays
        // off. For actual pop, no second schedule overrides us, and
        // the bar slides back in sync with the pop.
        animateTabBar(slidingOff: false)
    }

    private func animateTabBar(slidingOff: Bool) {
        guard let tabBar = findTabBar() else { return }
        let height = tabBar.frame.height
        let target: CGAffineTransform = slidingOff
            ? CGAffineTransform(translationX: 0, y: height)
            : .identity
        if tabBar.transform == target { return }

        if let coord = findTransitionCoordinator() {
            coord.animate(alongsideTransition: { _ in
                tabBar.transform = target
            }, completion: { _ in
                tabBar.transform = target
            })
        } else {
            tabBar.transform = target
        }
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

