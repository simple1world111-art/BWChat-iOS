// BWChat/Components/StickerViews.swift
// Sticker picker panel and sticker message rendering.

import SwiftUI
import UIKit

enum ComposerPanel: Equatable {
    case stickers
    case plus
}

enum ComposerSurface: Equatable {
    case keyboard
    case stickers
    case plus

    init(panel: ComposerPanel) {
        switch panel {
        case .stickers:
            self = .stickers
        case .plus:
            self = .plus
        }
    }

    var panel: ComposerPanel? {
        switch self {
        case .keyboard:
            return nil
        case .stickers:
            return .stickers
        case .plus:
            return .plus
        }
    }
}

struct ComposerSurfaceHeights: Equatable {
    private(set) var keyboard: CGFloat
    private(set) var stickers: CGFloat
    private(set) var plus: CGFloat

    init(stickerHeight: CGFloat, plusHeight: CGFloat) {
        keyboard = stickerHeight
        stickers = stickerHeight
        plus = plusHeight
    }

    func height(for surface: ComposerSurface) -> CGFloat {
        switch surface {
        case .keyboard:
            return keyboard
        case .stickers:
            return stickers
        case .plus:
            return plus
        }
    }

    mutating func record(_ height: CGFloat, for surface: ComposerSurface) {
        guard height.isFinite, height > 0 else { return }
        switch surface {
        case .keyboard:
            keyboard = height
        case .stickers:
            stickers = height
        case .plus:
            plus = height
        }
    }
}

enum ComposerPlusPanelMetrics {
    static let columns = 4
    static let itemHeight: CGFloat = 76
    static let rowSpacing: CGFloat = 18
    static let verticalPadding: CGFloat = 16

    static func preferredHeight(itemCount: Int) -> CGFloat {
        let rowCount = max(1, Int(ceil(Double(itemCount) / Double(columns))))
        return (verticalPadding * 2)
            + (CGFloat(rowCount) * itemHeight)
            + (CGFloat(max(0, rowCount - 1)) * rowSpacing)
    }
}

struct ComposerSurfaceTransition: Equatable {
    let from: ComposerSurface
    let to: ComposerSurface
    var reservedHeight: CGFloat
}

struct ComposerPanelRenderedHeightPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

struct ComposerPanelToggleButton: UIViewRepresentable {
    let inactiveSystemName: String
    let activeSystemName: String
    let isActive: Bool
    let accessibilityLabel: String
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .custom)
        button.tintColor = UIColor(AppColors.accent)
        button.imageView?.contentMode = .center
        button.accessibilityTraits = .button
        button.addTarget(
            context.coordinator,
            action: #selector(Coordinator.handleTap),
            for: .touchUpInside
        )
        updateButton(button)
        return button
    }

    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.action = action
        updateButton(button)
    }

    private func updateButton(_ button: UIButton) {
        let configuration = UIImage.SymbolConfiguration(
            pointSize: 28,
            weight: .regular
        )
        let image = UIImage(
            systemName: isActive ? activeSystemName : inactiveSystemName,
            withConfiguration: configuration
        )

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        UIView.performWithoutAnimation {
            button.layer.removeAllAnimations()
            button.imageView?.layer.removeAllAnimations()
            button.setImage(image, for: .normal)
            button.tintColor = UIColor(AppColors.accent)
            button.accessibilityLabel = accessibilityLabel
            if isActive {
                button.accessibilityTraits.insert(.selected)
            } else {
                button.accessibilityTraits.remove(.selected)
            }
            button.layoutIfNeeded()
        }
        CATransaction.commit()
    }

    final class Coordinator: NSObject {
        var action: () -> Void

        init(action: @escaping () -> Void) {
            self.action = action
        }

        @objc func handleTap() {
            action()
        }
    }
}

enum StickerPickerSelection: Equatable {
    case insertText(String)
    case sendSticker(StickerItem)
    case unavailable
}

extension StickerPack {
    func pickerSelection(for emoji: EmojiItem) -> StickerPickerSelection {
        guard isEmojiInput, let value = emoji.insertionValue else { return .unavailable }
        return .insertText(value)
    }

    func pickerSelection(for sticker: StickerItem) -> StickerPickerSelection {
        guard !isEmojiInput, !sticker.id.isBlank, !(sticker.assetKey ?? "").isBlank else { return .unavailable }
        return .sendSticker(sticker)
    }

    func performPickerSelection(
        _ selection: StickerPickerSelection,
        onInsertEmoji: (String) -> Void,
        onSendSticker: (StickerPack, StickerItem) -> Void
    ) {
        switch selection {
        case .insertText(let value):
            onInsertEmoji(value)
        case .sendSticker(let sticker):
            onSendSticker(self, sticker)
        case .unavailable:
            break
        }
    }
}

enum ComposerTextInsertion {
    static func insert(_ value: String, into text: inout String, selectedRange: inout NSRange) {
        guard !value.isEmpty else { return }
        let source = text as NSString
        let location = min(max(selectedRange.location, 0), source.length)
        let availableLength = source.length - location
        let length = min(max(selectedRange.length, 0), availableLength)
        text = source.replacingCharacters(in: NSRange(location: location, length: length), with: value)
        selectedRange = NSRange(location: location + (value as NSString).length, length: 0)
    }
}

struct StickerPanel: View {
    static let preferredHeight: CGFloat = 250
    static let minimumHeight: CGFloat = 220

    let onSend: (StickerPack, StickerItem) -> Void
    let onInsertEmoji: (String) -> Void

    @ObservedObject private var configStore = AppRemoteConfigStore.shared
    @State private var selectedPackID: String?

    private var packs: [StickerPack] {
        configStore.config.effectiveStickerPacks
    }

    private var selectedPack: StickerPack? {
        let id = selectedPackID ?? packs.first?.id
        return packs.first { $0.id == id } ?? packs.first
    }

    private var selectedStickers: [StickerItem] {
        (selectedPack?.stickers ?? [])
            .filter { !$0.id.isBlank && !($0.assetKey ?? "").isBlank }
            .sorted(by: StickerItem.sort)
    }

    private var selectedEmojis: [EmojiItem] {
        (selectedPack?.emojis ?? [])
            .filter { !$0.id.isBlank && $0.insertionValue != nil }
            .sorted(by: EmojiItem.sort)
    }

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: 10),
        count: 4
    )
    var body: some View {
        VStack(spacing: 0) {
            if packs.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "face.smiling")
                        .font(.system(size: 28))
                        .foregroundColor(AppColors.tertiaryText)
                    Text(L10n.tr("chat.stickers.empty"))
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.secondaryText)
                }
                .frame(maxWidth: .infinity)
                .frame(maxHeight: .infinity)
            } else {
                packTabs

                Divider()
                    .background(AppColors.separator)

                ScrollView {
                    if selectedPack?.isEmojiInput == true {
                        emojiGrid
                    } else {
                        stickerGrid
                    }
                }
                .frame(maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .secondarySystemBackground).opacity(0.98))
        .onAppear(perform: syncSelection)
        .task {
            await refreshStickersIfNeeded()
        }
        .onChange(of: packs.map(\.id)) { _ in
            syncSelection()
        }
    }

    private var packTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(packs) { pack in
                    Button {
                        selectedPackID = pack.id
                    } label: {
                        HStack(spacing: 5) {
                            if pack.isEmojiInput, let cover = pack.coverEmoji, !cover.isBlank {
                                Text(cover)
                                    .font(.system(size: 20))
                            } else if let assetKey = pack.coverAssetKey, !assetKey.isBlank {
                                StickerArtworkView(assetKey: assetKey, accessibilityLabel: pack.localizedName)
                                    .frame(width: 22, height: 22)
                            }
                            Text(pack.localizedName)
                                .font(.system(size: 13, weight: selectedPack?.id == pack.id ? .semibold : .regular))
                        }
                            .foregroundColor(selectedPack?.id == pack.id ? AppColors.accent : AppColors.secondaryText)
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .background(
                                Capsule()
                                    .fill(selectedPack?.id == pack.id ? AppColors.accent.opacity(0.12) : Color.clear)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
    }

    private var emojiGrid: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 8),
            spacing: 4
        ) {
            ForEach(selectedEmojis) { emoji in
                Button {
                    guard let selectedPack else { return }
                    selectedPack.performPickerSelection(
                        selectedPack.pickerSelection(for: emoji),
                        onInsertEmoji: onInsertEmoji,
                        onSendSticker: onSend
                    )
                } label: {
                    Text(emoji.insertionValue ?? "")
                        .font(.system(size: 28))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(emoji.localizedName)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }

    private var stickerGrid: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(selectedStickers) { sticker in
                Button {
                    guard let selectedPack else { return }
                    selectedPack.performPickerSelection(
                        selectedPack.pickerSelection(for: sticker),
                        onInsertEmoji: onInsertEmoji,
                        onSendSticker: onSend
                    )
                } label: {
                    VStack(spacing: 4) {
                        StickerArtworkView(
                            assetKey: sticker.assetKey,
                            accessibilityLabel: sticker.localizedName
                        )
                        .frame(width: 54, height: 54)

                        Text(sticker.localizedName)
                            .font(.system(size: 10))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 76)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(sticker.localizedName)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
    }

    private func syncSelection() {
        StickerPackDiagnostics.logDisplayed(packs)
        guard !packs.isEmpty else {
            selectedPackID = nil
            return
        }
        if let selectedPackID, packs.contains(where: { $0.id == selectedPackID }) {
            return
        }
        selectedPackID = packs.first?.id
    }

    @MainActor
    private func refreshStickersIfNeeded() async {
        await configStore.load()
        if configStore.source == .bundled || packs.allSatisfy({ $0.id == "emoji_default" }) {
            await configStore.forceRefresh(ignoreETag: true)
        }
        syncSelection()
    }
}

struct StickerMessageBubble: View {
    let payload: StickerMessagePayload
    let timeText: String
    let isFromMe: Bool
    var senderName: String?

    var body: some View {
        VStack(alignment: isFromMe ? .trailing : .leading, spacing: 4) {
            if let senderName, !senderName.isBlank {
                Text(senderName)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
            }

            ZStack(alignment: .bottomTrailing) {
                StickerArtworkView(
                    assetKey: payload.assetKey,
                    accessibilityLabel: payload.localizedName
                )
                .frame(width: stickerSize.width, height: stickerSize.height)
                .padding(8)
                .background(Color.white.opacity(isFromMe ? 0.18 : 0.72))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: .black.opacity(0.06), radius: 4, x: 0, y: 2)

                Text(timeText)
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.secondaryText)
                    .monospacedDigit()
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color.white.opacity(0.82))
                    .clipShape(Capsule())
                    .padding(4)
            }
        }
        .accessibilityLabel(payload.localizedName)
    }

    private var stickerSize: CGSize {
        let maxSide: CGFloat = 148
        let fallback = CGSize(width: maxSide, height: maxSide)
        guard let width = payload.width,
              let height = payload.height,
              width > 0,
              height > 0 else {
            return fallback
        }
        let scale = min(maxSide / CGFloat(width), maxSide / CGFloat(height), 1)
        return CGSize(width: CGFloat(width) * scale, height: CGFloat(height) * scale)
    }
}

struct StickerArtworkView: View {
    let assetKey: String?
    var accessibilityLabel: String = ""

    var body: some View {
        RemoteAssetImage(
            assetKey: assetKey,
            fallbackSystemImage: "face.smiling",
            fallbackText: accessibilityLabel,
            contentMode: .fit
        )
        .accessibilityHidden(accessibilityLabel.isBlank)
        .accessibilityLabel(accessibilityLabel)
    }
}
