// BWChat/Utils/Extensions.swift
// Swift type extensions

import SwiftUI
import UIKit

// MARK: - View Extensions

extension View {
    /// Hide keyboard
    func hideKeyboard() {
        let keyWindow = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)

        if keyWindow?.endEditing(true) != true {
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder),
                to: nil,
                from: nil,
                for: nil
            )
        }
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

    func chatComposerBarBackground(showsStickerPanel: Bool = false) -> some View {
        background {
            ZStack {
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.82),
                        Color.white.opacity(0.96)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .opacity(showsStickerPanel ? 0 : 1)

                Color(uiColor: .secondarySystemBackground)
                    .opacity(showsStickerPanel ? 0.98 : 0)
            }
            .ignoresSafeArea(edges: .bottom)
            .animation(.easeInOut(duration: 0.25), value: showsStickerPanel)
        }
    }
}

struct ChatComposerActionButtonStyle: ButtonStyle {
    let isActive: Bool
    var showsActiveBackground = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Circle()
                    .fill(
                        isActive && showsActiveBackground
                            ? AppColors.accent.opacity(0.14)
                            : Color.primary.opacity(configuration.isPressed ? 0.07 : 0)
                    )
            )
            .scaleEffect(configuration.isPressed ? 0.88 : 1)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

struct KeyboardDismissTapInstaller: UIViewRepresentable {
    let isEnabled: Bool
    let consumesOutsideTaps: Bool
    let dismissesOnControls: Bool
    let onBackgroundTap: () -> Void

    init(
        isEnabled: Bool,
        consumesOutsideTaps: Bool = false,
        dismissesOnControls: Bool = false,
        onBackgroundTap: @escaping () -> Void = {}
    ) {
        self.isEnabled = isEnabled
        self.consumesOutsideTaps = consumesOutsideTaps
        self.dismissesOnControls = dismissesOnControls
        self.onBackgroundTap = onBackgroundTap
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            isEnabled: isEnabled,
            consumesOutsideTaps: consumesOutsideTaps,
            dismissesOnControls: dismissesOnControls,
            onBackgroundTap: onBackgroundTap
        )
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.isEnabled = isEnabled
        context.coordinator.consumesOutsideTaps = consumesOutsideTaps
        context.coordinator.dismissesOnControls = dismissesOnControls
        context.coordinator.onBackgroundTap = onBackgroundTap
        DispatchQueue.main.async {
            context.coordinator.installIfNeeded(from: uiView)
        }
    }

    static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var isEnabled: Bool
        var consumesOutsideTaps: Bool
        var dismissesOnControls: Bool
        var onBackgroundTap: () -> Void
        private weak var installedWindow: UIWindow?
        private weak var recognizer: UITapGestureRecognizer?
        private var shouldDismissKeyboardForCurrentTap = true

        init(
            isEnabled: Bool,
            consumesOutsideTaps: Bool,
            dismissesOnControls: Bool,
            onBackgroundTap: @escaping () -> Void
        ) {
            self.isEnabled = isEnabled
            self.consumesOutsideTaps = consumesOutsideTaps
            self.dismissesOnControls = dismissesOnControls
            self.onBackgroundTap = onBackgroundTap
        }

        func installIfNeeded(from view: UIView) {
            guard let window = view.window else { return }

            if installedWindow !== window {
                uninstall()

                let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap))
                recognizer.cancelsTouchesInView = false
                recognizer.delegate = self
                window.addGestureRecognizer(recognizer)

                installedWindow = window
                self.recognizer = recognizer
            }

            recognizer?.isEnabled = isEnabled
            if !isEnabled || !consumesOutsideTaps {
                recognizer?.cancelsTouchesInView = false
            }
        }

        func uninstall() {
            if let recognizer, let installedWindow {
                installedWindow.removeGestureRecognizer(recognizer)
            }
            recognizer = nil
            installedWindow = nil
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard isEnabled else { return false }
            guard !Self.isKeyboardTouch(touch.view) else {
                gestureRecognizer.cancelsTouchesInView = false
                return false
            }
            guard !Self.isTextInput(touch.view) else {
                gestureRecognizer.cancelsTouchesInView = false
                return false
            }
            if Self.isSystemControlTouch(touch.view), !dismissesOnControls {
                gestureRecognizer.cancelsTouchesInView = false
                return false
            }
            shouldDismissKeyboardForCurrentTap = true
            gestureRecognizer.cancelsTouchesInView = consumesOutsideTaps && shouldDismissKeyboardForCurrentTap
            return true
        }

        @objc private func handleTap() {
            guard isEnabled else { return }
            guard shouldDismissKeyboardForCurrentTap else { return }
            onBackgroundTap()
        }

        private static func isTextInput(_ view: UIView?) -> Bool {
            var current = view
            while let candidate = current {
                if candidate is UITextField || candidate is UITextView {
                    return true
                }
                current = candidate.superview
            }
            return false
        }

        private static func isSystemControlTouch(_ view: UIView?) -> Bool {
            var current = view
            while let candidate = current {
                if candidate is UIControl {
                    return true
                }

                let className = NSStringFromClass(type(of: candidate))
                if className.contains("UINavigationBar")
                    || className.contains("UIToolbar")
                    || className.contains("UIButton")
                    || className.contains("BarButton")
                    || className.contains("HostingNavigation") {
                    return true
                }

                current = candidate.superview
            }
            return false
        }

        private static func isKeyboardTouch(_ view: UIView?) -> Bool {
            var current = view
            while let candidate = current {
                let className = NSStringFromClass(type(of: candidate))
                if className.contains("UIKeyboard") || className.contains("UITextEffects") {
                    return true
                }
                current = candidate.superview
            }
            return false
        }
    }
}

private struct MessageMenuLongPressModifier: ViewModifier {
    let onLongPress: (CGRect) -> Void
    let onTouchSequenceEnded: () -> Void

    func body(content: Content) -> some View {
        content
            .contentShape(Rectangle())
            .background {
                MessageMenuLongPressBridge(
                    onLongPress: onLongPress,
                    onTouchSequenceEnded: onTouchSequenceEnded
                )
            }
    }
}

private struct MessageMenuLongPressBridge: UIViewRepresentable {
    let onLongPress: (CGRect) -> Void
    let onTouchSequenceEnded: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onLongPress: onLongPress,
            onTouchSequenceEnded: onTouchSequenceEnded
        )
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.onLongPress = onLongPress
        context.coordinator.onTouchSequenceEnded = onTouchSequenceEnded
        DispatchQueue.main.async {
            context.coordinator.installIfNeeded(sourceView: uiView)
        }
    }

    static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var onLongPress: (CGRect) -> Void
        var onTouchSequenceEnded: () -> Void
        private weak var sourceView: UIView?
        private weak var installedWindow: UIWindow?
        private weak var recognizer: UILongPressGestureRecognizer?

        init(
            onLongPress: @escaping (CGRect) -> Void,
            onTouchSequenceEnded: @escaping () -> Void
        ) {
            self.onLongPress = onLongPress
            self.onTouchSequenceEnded = onTouchSequenceEnded
        }

        func installIfNeeded(sourceView: UIView) {
            guard let window = sourceView.window else { return }
            self.sourceView = sourceView
            guard installedWindow !== window || recognizer == nil else { return }
            uninstall()
            self.sourceView = sourceView

            let recognizer = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
            recognizer.minimumPressDuration = 0.45
            recognizer.allowableMovement = 20
            // A successful long press owns this touch sequence. Cancelling the
            // underlying touch prevents tappable bubbles (money/media) from
            // navigating when the finger is lifted after opening the menu.
            recognizer.cancelsTouchesInView = true
            recognizer.delaysTouchesBegan = false
            recognizer.delegate = self
            window.addGestureRecognizer(recognizer)
            installedWindow = window
            self.recognizer = recognizer
        }

        func uninstall() {
            if let recognizer, let installedWindow {
                installedWindow.removeGestureRecognizer(recognizer)
            }
            recognizer = nil
            installedWindow = nil
            sourceView = nil
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let sourceView, let window = installedWindow else { return false }
            let bubbleFrame = sourceView.convert(sourceView.bounds, to: window).standardized
            return bubbleFrame.contains(gestureRecognizer.location(in: window))
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldReceive touch: UITouch
        ) -> Bool {
            // The recognizer lives on the window so bubbles can coexist with
            // scroll gestures. Never let a bubble underneath the composer
            // claim a long press that belongs to UIKit's text editor.
            var view = touch.view
            while let candidate = view {
                if candidate is UITextInput {
                    return false
                }
                let className = NSStringFromClass(type(of: candidate))
                if className.contains("UIKeyboard") || className.contains("UITextEffects") {
                    return false
                }
                view = candidate.superview
            }
            return true
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            // Money and media bubbles own their own tap recognizers. Both must
            // observe the sequence so the long press can begin; the row-level
            // activation gate prevents their tap action from committing.
            true
        }

        @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
            switch recognizer.state {
            case .began:
                guard let sourceView, let window = installedWindow else { return }
                let visibleFrame = sourceView.convert(sourceView.bounds, to: window).standardized
                guard !visibleFrame.isEmpty else { return }
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                onLongPress(visibleFrame)
            case .ended, .cancelled:
                onTouchSequenceEnded()
            default:
                break
            }
        }
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

    /// Removes transport/editor line terminators that some message responses
    /// append, while preserving intentional leading and internal line breaks.
    var trimmingTrailingLineBreaks: String {
        var result = self
        while let last = result.last, last.isNewline {
            result.removeLast()
        }
        return result
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
    var selectedRange: Binding<NSRange>? = nil
    var mentionSpans: Binding<[MentionSpan]>? = nil

    var minHeight: CGFloat = 40
    var maxHeight: CGFloat = 112
    var returnKeyType: UIReturnKeyType = .send
    var enablesReturnKeyAutomatically: Bool = true
    var allowsNewline: Bool = false
    var textAlignment: NSTextAlignment = .natural
    var preferredPrimaryLanguage: String? = "zh-Hans"
    var onRequestFocus: (() -> Void)? = nil
    var onSend: ((String) -> Void)? = nil
    var onStandaloneAt: ((NSRange) -> Void)? = nil

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
        let requestedRange = selectedRange?.wrappedValue ?? textView.selectedRange

        // Assigning UITextView.text resets its selection and can synchronously
        // call the delegate. Keep those UIKit callbacks from overwriting the
        // SwiftUI-owned cursor while applying a programmatic text insertion.
        context.coordinator.isApplyingParentUpdate = true
        defer { context.coordinator.isApplyingParentUpdate = false }

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

        if textView.markedTextRange == nil {
            let textLength = (textView.text as NSString? ?? "").length
            let location = min(max(requestedRange.location, 0), textLength)
            let length = min(max(requestedRange.length, 0), textLength - location)
            let nextRange = NSRange(location: location, length: length)
            if textView.selectedRange != nextRange {
                textView.selectedRange = nextRange
            }
        }

        context.coordinator.updateHeight(for: textView)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ChatInputTextView
        var isApplyingParentUpdate = false

        init(_ parent: ChatInputTextView) {
            self.parent = parent
        }

        func textViewShouldBeginEditing(_ textView: UITextView) -> Bool {
            guard !parent.isFocused, let onRequestFocus = parent.onRequestFocus else {
                return true
            }
            onRequestFocus()
            return false
        }

        // SwiftUI owns focus. Writing `true` here can arrive after a dismiss
        // action and immediately make the text view first responder again.
        func textViewDidBeginEditing(_ textView: UITextView) {}

        func textViewDidEndEditing(_ textView: UITextView) {
            // The final UIKit value may not have reached SwiftUI while an IME
            // still had marked text. Commit it before the chat view flushes its
            // draft during navigation or backgrounding.
            commitText(from: textView)
            parent.isFocused = false
        }

        func textViewDidChange(_ textView: UITextView) {
            guard !isApplyingParentUpdate else { return }
            guard textView.markedTextRange == nil else {
                updateHeight(for: textView)
                return
            }

            commitText(from: textView)
            updateHeight(for: textView)
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !isApplyingParentUpdate,
                  textView.isFirstResponder,
                  textView.markedTextRange == nil else { return }
            commitText(from: textView)
            if parent.selectedRange?.wrappedValue != textView.selectedRange {
                parent.selectedRange?.wrappedValue = textView.selectedRange
            }
        }

        private func commitText(from textView: UITextView) {
            if parent.text != textView.text {
                parent.text = textView.text
            }
            if parent.selectedRange?.wrappedValue != textView.selectedRange {
                parent.selectedRange?.wrappedValue = textView.selectedRange
            }
        }

        func textView(
            _ textView: UITextView,
            shouldChangeTextIn range: NSRange,
            replacementText replacement: String
        ) -> Bool {
            if replacement == "\n", let send = parent.onSend {
                // A Chinese/Japanese IME can still own marked text when its
                // Return key is labelled Send. Letting that newline through
                // first commits the candidate and postpones submission to a
                // later input event. Commit the visible candidate now and use
                // the resulting UIKit value as the send snapshot.
                if textView.markedTextRange != nil {
                    isApplyingParentUpdate = true
                    textView.unmarkText()
                    isApplyingParentUpdate = false
                }

                let submittedText = textView.text ?? ""
                guard !submittedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    return false
                }

                // Do not publish the optimistic message while UIKit is still
                // handling the keyboard event. That can synchronously
                // invalidate the entire SwiftUI timeline before the remote
                // keyboard finishes its key-up animation.
                isApplyingParentUpdate = true
                textView.text = ""
                textView.selectedRange = NSRange(location: 0, length: 0)
                textView.invalidateIntrinsicContentSize()
                isApplyingParentUpdate = false

                let textBinding = parent.$text
                let selectionBinding = parent.selectedRange
                DispatchQueue.main.async {
                    if textBinding.wrappedValue == submittedText {
                        textBinding.wrappedValue = ""
                    }
                    selectionBinding?.wrappedValue = NSRange(location: 0, length: 0)
                    send(submittedText)
                }
                return false
            }

            guard textView.markedTextRange == nil else { return true }

            if replacement != "\n", let mentionSpans = parent.mentionSpans {
                let document = ComposerDocument(
                    text: textView.text ?? "",
                    mentions: mentionSpans.wrappedValue
                )
                let result = MentionTextEditing.applyingUserEdit(
                    range: range,
                    replacementText: replacement,
                    to: document
                )
                mentionSpans.wrappedValue = result.document.mentions

                if result.handledAtomically {
                    isApplyingParentUpdate = true
                    textView.text = result.document.text
                    textView.selectedRange = result.selectedRange
                    parent.text = result.document.text
                    parent.selectedRange?.wrappedValue = result.selectedRange
                    isApplyingParentUpdate = false
                    updateHeight(for: textView)
                    return false
                }

                if MentionTextEditing.isStandaloneAtInsertion(
                    text: document.text,
                    range: range,
                    replacement: replacement
                ) {
                    let insertedRange = NSRange(location: range.location, length: 1)
                    DispatchQueue.main.async { [weak self] in
                        self?.parent.onStandaloneAt?(insertedRange)
                    }
                }
            }

            return replacement == "\n" ? parent.allowsNewline : true
        }

        @available(iOS 16.0, *)
        func textView(
            _ textView: UITextView,
            editMenuForTextIn range: NSRange,
            suggestedActions: [UIMenuElement]
        ) -> UIMenu? {
            let systemActions = suggestedActions.compactMap(removingAutoFillAction)
            let newlineAction = UIAction(
                title: L10n.tr("chat.input.newline"),
                image: UIImage(systemName: "return")
            ) { [weak self, weak textView] _ in
                guard let self, let textView else { return }
                self.insertNewline(in: textView)
            }
            return UIMenu(children: systemActions + [newlineAction])
        }

        @available(iOS 16.0, *)
        private func removingAutoFillAction(_ element: UIMenuElement) -> UIMenuElement? {
            if isAutoFillAction(element) {
                return nil
            }
            guard let menu = element as? UIMenu else {
                return element
            }

            let children = menu.children.compactMap(removingAutoFillAction)
            guard !children.isEmpty else { return nil }
            return UIMenu(
                title: menu.title,
                image: menu.image,
                identifier: menu.identifier,
                options: menu.options,
                children: children
            )
        }

        @available(iOS 16.0, *)
        private func isAutoFillAction(_ element: UIMenuElement) -> Bool {
            if let action = element as? UIAction,
               action.identifier.rawValue.localizedCaseInsensitiveContains("autofill") {
                return true
            }

            let compactTitle = element.title
                .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
                .replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: "-", with: "")
            return [
                "autofill",
                "自动填充",
                "自動填充",
                "自動填寫",
                "自動入力",
                "자동완성",
                "autocompletar",
                "autorrelleno",
                "preenchimentoautomático",
                "remplissageautomatique",
                "automatischausfüllen",
                "автозаполнение"
            ].contains(compactTitle.lowercased())
        }

        private func insertNewline(in textView: UITextView) {
            let currentText = textView.text ?? ""
            let selection = textView.selectedRange
            let document = ComposerDocument(
                text: currentText,
                mentions: parent.mentionSpans?.wrappedValue ?? []
            )
            let result = MentionTextEditing.applyingUserEdit(
                range: selection,
                replacementText: "\n",
                to: document
            )

            isApplyingParentUpdate = true
            textView.text = result.document.text
            textView.selectedRange = result.selectedRange
            parent.text = result.document.text
            parent.selectedRange?.wrappedValue = result.selectedRange
            parent.mentionSpans?.wrappedValue = result.document.mentions
            isApplyingParentUpdate = false
            updateHeight(for: textView)
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
            // Backend SQL timestamps without an explicit offset are UTC.
            // Pin the formatter so list ordering does not vary by device timezone.
            f.timeZone = TimeZone(secondsFromGMT: 0)
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
    func messageMenuLongPress(
        onLongPress: @escaping (CGRect) -> Void,
        onTouchSequenceEnded: @escaping () -> Void = {}
    ) -> some View {
        modifier(MessageMenuLongPressModifier(
            onLongPress: onLongPress,
            onTouchSequenceEnded: onTouchSequenceEnded
        ))
    }

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
        modifier(UIKitBackButtonModifier(tint: tint, onBack: nil))
    }

    func withUIKitBackButton(tint: Color = AppColors.primaryText, onBack: @escaping () -> Void) -> some View {
        modifier(UIKitBackButtonModifier(tint: tint, onBack: onBack))
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
    let onBack: (() -> Void)?

    func body(content: Content) -> some View {
        content
            .navigationBarBackButtonHidden(true)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    AppBackButton(tint: tint) {
                        if let onBack {
                            onBack()
                        } else if navigator.canPopPushedController {
                            navigator.pop()
                        } else {
                            dismiss()
                        }
                    }
                }
            }
    }
}
