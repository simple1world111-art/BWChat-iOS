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
    /// NavigationStack. Bridges to UIKit's native
    /// `hidesBottomBarWhenPushed`:
    ///   - In `willMove(toParent:)` we walk up to find the
    ///     UIHostingController SwiftUI just built for this pushed view.
    ///   - We set its `hidesBottomBarWhenPushed = true` BEFORE SwiftUI
    ///     calls `pushViewController` on it.
    ///   - UIKit then handles the whole transition: tab bar animates
    ///     off during push, safe-area insets adjust automatically so
    ///     content fills the freed space (no blank strip under the
    ///     input bar), and the bar slides back on pop.
    ///
    /// Why not the transform / additionalSafeAreaInsets approach we
    /// tried before? `additionalSafeAreaInsets` rejects negative
    /// values (Apple's docs: "The property must not contain any
    /// negative values."), so cancelling the tab bar's contribution
    /// silently no-op'd and left the blank strip.
    func hidesTabBarOnPush() -> some View {
        background(HidesTabBarBridge())
    }
}

private struct HidesTabBarBridge: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> BridgeController { BridgeController() }
    func updateUIViewController(_ uiViewController: BridgeController, context: Context) {}
}

private final class BridgeController: UIViewController {
    override func willMove(toParent parent: UIViewController?) {
        super.willMove(toParent: parent)
        // SwiftUI adds us as a child of the destination's hosting
        // controller during that hosting controller's construction —
        // which happens BEFORE SwiftUI pushes it onto the underlying
        // UINavigationController. Setting the flag here means UIKit
        // sees it at push time and animates the tab bar off natively.
        guard let parent else { return }
        var vc: UIViewController? = parent
        while let current = vc {
            if String(describing: type(of: current)).contains("HostingController") {
                current.hidesBottomBarWhenPushed = true
                return
            }
            vc = current.parent
        }
    }
}

