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

    /// Long-press to show a save/cancel confirmation before saving media.
    /// Uses .simultaneousGesture so it coexists with ancestor DragGestures
    /// (e.g. swipe-to-reply on MessageBubble) without being swallowed.
    func longPressToSaveImage(url: String) -> some View {
        modifier(LongPressSaveMediaModifier(url: url, kind: .image))
    }

    func longPressToSaveVideo(url: String) -> some View {
        modifier(LongPressSaveMediaModifier(url: url, kind: .video))
    }

    func chatComposerFieldChrome(minHeight: CGFloat) -> some View {
        modifier(ChatComposerFieldChromeModifier(minHeight: minHeight))
    }

    func chatComposerRecordChrome(
        isRecording: Bool,
        isCanceling: Bool,
        minHeight: CGFloat
    ) -> some View {
        modifier(ChatComposerRecordChromeModifier(
            isRecording: isRecording,
            isCanceling: isCanceling,
            minHeight: minHeight
        ))
    }

    func chatComposerBarBackground() -> some View {
        background(
            LinearGradient(
                colors: [
                    Color.white.opacity(0.82),
                    Color.white.opacity(0.96)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        )
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
                Button(kind == .image ? L10n.tr("media.saveImage") : L10n.tr("media.saveVideo")) {
                    let u = url
                    Task {
                        switch kind {
                        case .image: await MediaLibrarySaver.saveImage(mediaPath: u)
                        case .video: await MediaLibrarySaver.saveVideo(mediaPath: u)
                        }
                    }
                }
                Button(L10n.tr("common.cancel"), role: .cancel) {}
            }
    }
}

private struct ChatComposerFieldChromeModifier: ViewModifier {
    let minHeight: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(.vertical, 7)
            .padding(.horizontal, 13)
            .background(Color.white.opacity(0.92))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.white.opacity(0.85), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .contentShape(Rectangle())
            .shadow(color: Color.black.opacity(0.04), radius: 8, x: 0, y: 3)
            .frame(minHeight: minHeight)
    }
}

private struct ChatComposerRecordChromeModifier: ViewModifier {
    let isRecording: Bool
    let isCanceling: Bool
    let minHeight: CGFloat

    private var fillColor: Color {
        if isRecording {
            return isCanceling ? Color.red.opacity(0.8) : AppColors.accent
        }
        return Color.white.opacity(0.92)
    }

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(fillColor)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(isRecording ? Color.clear : Color.white.opacity(0.85), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .contentShape(Rectangle())
            .shadow(color: Color.black.opacity(isRecording ? 0.0 : 0.04), radius: 8, x: 0, y: 3)
    }
}

// MARK: - String Extensions

extension String {
    var isBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Chat Text Input

private final class PreferredLanguageTextView: UITextView {
    var preferredPrimaryLanguage: String?

    override var textInputMode: UITextInputMode? {
        guard let preferredPrimaryLanguage else {
            return super.textInputMode
        }

        return UITextInputMode.activeInputModes.first { mode in
            guard let language = mode.primaryLanguage else { return false }
            return language == preferredPrimaryLanguage
                || language.hasPrefix("\(preferredPrimaryLanguage)-")
                || preferredPrimaryLanguage.hasPrefix("\(language)-")
        } ?? super.textInputMode
    }
}

struct ChatInputTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    @Binding var height: CGFloat

    var minHeight: CGFloat = 40
    var maxHeight: CGFloat = 112
    var returnKeyType: UIReturnKeyType = .send
    var enablesReturnKeyAutomatically: Bool = true
    var allowsNewline: Bool = false
    var textAlignment: NSTextAlignment = .natural
    var preferredPrimaryLanguage: String? = "zh-Hans"
    var onSend: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = PreferredLanguageTextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.font = .systemFont(ofSize: 16)
        textView.textColor = UIColor(AppColors.primaryText)
        textView.tintColor = UIColor(AppColors.accent)
        textView.preferredPrimaryLanguage = preferredPrimaryLanguage
        textView.textContainerInset = UIEdgeInsets(top: 9, left: 0, bottom: 9, right: 0)
        textView.textContainer.lineFragmentPadding = 0
        textView.isScrollEnabled = false
        textView.returnKeyType = returnKeyType
        textView.enablesReturnKeyAutomatically = enablesReturnKeyAutomatically
        textView.textAlignment = textAlignment
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        textView.returnKeyType = returnKeyType
        textView.enablesReturnKeyAutomatically = enablesReturnKeyAutomatically
        textView.textAlignment = textAlignment
        (textView as? PreferredLanguageTextView)?.preferredPrimaryLanguage = preferredPrimaryLanguage

        if textView.text != text && textView.markedTextRange == nil {
            textView.text = text
        }

        if isFocused && !textView.isFirstResponder {
            textView.becomeFirstResponder()
        } else if !isFocused && textView.isFirstResponder {
            textView.resignFirstResponder()
        }

        context.coordinator.updateHeight(for: textView)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ChatInputTextView

        init(_ parent: ChatInputTextView) {
            self.parent = parent
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }

        func textViewDidChange(_ textView: UITextView) {
            guard textView.markedTextRange == nil else {
                updateHeight(for: textView)
                return
            }

            commitText(from: textView)
            updateHeight(for: textView)
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard textView.markedTextRange == nil else { return }
            commitText(from: textView)
        }

        private func commitText(from textView: UITextView) {
            if parent.text != textView.text {
                parent.text = textView.text
            }
        }

        func textView(
            _ textView: UITextView,
            shouldChangeTextIn range: NSRange,
            replacementText replacement: String
        ) -> Bool {
            guard replacement == "\n", textView.markedTextRange == nil else {
                return true
            }

            guard let send = parent.onSend else {
                return parent.allowsNewline
            }

            let current = textView.text as NSString? ?? ""
            let next = current.replacingCharacters(in: range, with: "")
            guard !next.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return false
            }

            DispatchQueue.main.async { send() }
            return false
        }

        func updateHeight(for textView: UITextView) {
            guard textView.bounds.width > 0 else { return }
            let fittingSize = CGSize(
                width: textView.bounds.width,
                height: CGFloat.greatestFiniteMagnitude
            )
            let measured = textView.sizeThatFits(fittingSize).height
            let nextHeight = min(max(parent.minHeight, measured), parent.maxHeight)
            textView.isScrollEnabled = measured > parent.maxHeight

            guard abs(parent.height - nextHeight) > 0.5 else { return }
            DispatchQueue.main.async {
                self.parent.height = nextHeight
            }
        }
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

    private static let fallbackFormatters: [DateFormatter] = {
        [
            "yyyy-MM-dd HH:mm:ss.SSSSSS",
            "yyyy-MM-dd HH:mm:ss.SSS",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSS",
            "yyyy-MM-dd'T'HH:mm:ss.SSS",
            "yyyy-MM-dd'T'HH:mm:ss"
        ].map { format in
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = format
            return f
        }
    }()

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f
    }()

    private static let listDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM/dd"
        return f
    }()

    private static let detailedDateTimeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    static func parse(_ string: String) -> Date? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return isoFormatter.date(from: trimmed)
            ?? isoFormatterNoFrac.date(from: trimmed)
            ?? fallbackFormatters.lazy.compactMap { $0.date(from: trimmed) }.first
    }

    static func formatTime(_ date: Date) -> String {
        timeFormatter.string(from: date)
    }

    static func formatTime(_ string: String) -> String {
        guard let date = parse(string) else { return string }
        return formatTime(date)
    }

    static func formatListTime(_ string: String?) -> String {
        guard let string, let date = parse(string) else { return "" }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return timeFormatter.string(from: date)
        } else if calendar.isDateInYesterday(date) {
            return L10n.tr("time.yesterday")
        } else {
            return listDateFormatter.string(from: date)
        }
    }

    static func formatDetailedDateTime(_ string: String?) -> String {
        guard let string, let date = parse(string) else { return string ?? "" }
        return detailedDateTimeFormatter.string(from: date)
    }

    static func formatSeparator(_ string: String) -> String {
        guard let date = parse(string) else { return string }
        let cal = Calendar.current
        let tf = DateFormatter()
        tf.locale = AppLanguageStore.shared.locale
        if cal.isDateInToday(date) {
            tf.dateFormat = "HH:mm"
        } else if cal.isDateInYesterday(date) {
            return "\(L10n.tr("time.yesterday")) \(timeFormatter.string(from: date))"
        } else if cal.component(.year, from: date) == cal.component(.year, from: Date()) {
            tf.setLocalizedDateFormatFromTemplate("MMMd HH:mm")
        } else {
            tf.setLocalizedDateFormatFromTemplate("yMMMd HH:mm")
        }
        return tf.string(from: date)
    }

    static func shouldShowTime(current: String, previous: String?) -> Bool {
        guard let prev = previous else { return true }
        guard let curDate = parse(current), let prevDate = parse(prev) else { return false }
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
    /// Keeps the root tab bar hidden while a detail view is visible.
    /// UIKitNavigator covers the normal push path; this modifier is a
    /// lightweight fallback for SwiftUI NavigationStack destinations and for
    /// iOS tab bar states that restore visibility after a transition.
    func hidesTabBarOnPush() -> some View {
        modifier(TabBarHiddenWhileVisibleModifier())
    }

    /// Restores a predictable back button for views pushed by `UIKitNavigator`,
    /// especially when the source tab hides its navigation bar.
    func withUIKitBackButton(tint: Color = AppColors.primaryText) -> some View {
        modifier(UIKitBackButtonModifier(tint: tint))
    }
}

struct AppBackButton: View {
    var tint: Color = AppColors.primaryText
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.left")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(tint)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.tr("common.back"))
    }
}

private struct TabBarHiddenWhileVisibleModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(TabBarVisibilityBridge())
    }
}

private struct TabBarVisibilityBridge: UIViewRepresentable {
    final class Coordinator {
        weak var tabBarController: UITabBarController?
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isHidden = true
        DispatchQueue.main.async {
            Self.setTabBarHidden(true, from: view, coordinator: context.coordinator)
        }
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        DispatchQueue.main.async {
            Self.setTabBarHidden(true, from: uiView, coordinator: context.coordinator)
        }
    }

    static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) {
        DispatchQueue.main.async {
            Self.restoreTabBarIfNeeded(from: uiView, coordinator: coordinator)
        }
    }

    private static func setTabBarHidden(_ hidden: Bool, from view: UIView, coordinator: Coordinator) {
        guard let tabBarController = enclosingTabBarController(from: view) else { return }
        coordinator.tabBarController = tabBarController
        let tabBar = tabBarController.tabBar
        tabBar.isHidden = hidden
        tabBar.alpha = hidden ? 0 : 1
        tabBar.isUserInteractionEnabled = !hidden
        tabBar.transform = .identity
    }

    private static func restoreTabBarIfNeeded(from view: UIView, coordinator: Coordinator) {
        guard let tabBarController = coordinator.tabBarController ?? enclosingTabBarController(from: view) else { return }
        let selectedNav = tabBarController.selectedViewController as? UINavigationController
        guard (selectedNav?.viewControllers.count ?? 1) <= 1 else { return }
        let tabBar = tabBarController.tabBar
        tabBar.isHidden = false
        tabBar.alpha = 1
        tabBar.isUserInteractionEnabled = true
        tabBar.transform = .identity
    }

    private static func enclosingTabBarController(from view: UIView) -> UITabBarController? {
        var responder: UIResponder? = view
        while let current = responder {
            if let tabBarController = current as? UITabBarController {
                return tabBarController
            }
            if let viewController = current as? UIViewController,
               let tabBarController = viewController.tabBarController {
                return tabBarController
            }
            responder = current.next
        }
        return view.window?.rootViewController?.findTabBarController()
    }
}

private extension UIViewController {
    func findTabBarController() -> UITabBarController? {
        if let tabBarController = self as? UITabBarController {
            return tabBarController
        }
        for child in children {
            if let tabBarController = child.findTabBarController() {
                return tabBarController
            }
        }
        return presentedViewController?.findTabBarController()
    }
}

private struct UIKitBackButtonModifier: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator
    let tint: Color

    func body(content: Content) -> some View {
        content
            .navigationBarBackButtonHidden(true)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    AppBackButton(tint: tint) {
                        if navigator.canPopPushedController {
                            navigator.pop()
                        } else {
                            dismiss()
                        }
                    }
                }
            }
    }
}
