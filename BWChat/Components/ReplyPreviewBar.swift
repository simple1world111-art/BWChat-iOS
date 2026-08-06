// BWChat/Components/ReplyPreviewBar.swift
// Compact bar showing the message being replied to

import SwiftUI
import UIKit

/// Immutable render input for a chat timeline. Views replace this only when
/// message or optimistic-send collections change, so composer and keyboard
/// updates do not repeat parsing, reply resolution, merging, or sorting.
struct ChatTimelineSnapshot<Item> {
    let items: [Item]
}

enum MessageMenuAction: String, Hashable, CaseIterable {
    case copy
    case retry
    case forward
    case save
    case quote
    case recall
    case delete
    case multiSelect

    var title: String {
        switch self {
        case .copy: return L10n.tr("common.copy")
        case .retry: return L10n.tr("common.retry")
        case .forward: return L10n.tr("chat.action.forward")
        case .save: return L10n.tr("common.save")
        case .quote: return L10n.tr("common.reply")
        case .recall: return L10n.tr("chat.action.recall")
        case .delete: return L10n.tr("common.delete")
        case .multiSelect: return L10n.tr("chat.action.multiSelect")
        }
    }

    var systemImage: String {
        switch self {
        case .copy: return "doc.on.doc"
        case .retry: return "arrow.clockwise"
        case .forward: return "arrowshape.turn.up.right"
        case .save: return "square.and.arrow.down"
        case .quote: return "quote.bubble"
        case .recall: return "arrow.uturn.backward"
        case .delete: return "trash"
        case .multiSelect: return "checkmark.circle"
        }
    }
}

enum ConversationRef: Hashable, Codable {
    case direct(userID: String)
    case group(groupID: Int)
}

struct MessageRef: Hashable, Codable {
    let accountID: String
    let conversation: ConversationRef
    let messageID: Int
}

struct MessageSelectionDescriptor: Hashable {
    let timestamp: Date
    let messageType: String
    let canForwardIndividually: Bool
    let canMerge: Bool
    let canDelete: Bool
}

struct MessageSelectionState: Equatable {
    static let maximumCount = 99

    var selected: Set<MessageRef> = []
    var descriptors: [MessageRef: MessageSelectionDescriptor] = [:]

    var orderedSelection: [MessageRef] {
        selected.sorted { lhs, rhs in
            let left = descriptors[lhs]
            let right = descriptors[rhs]
            if left?.timestamp == right?.timestamp {
                return lhs.messageID < rhs.messageID
            }
            return (left?.timestamp ?? .distantPast) < (right?.timestamp ?? .distantPast)
        }
    }

    @discardableResult
    mutating func toggle(_ reference: MessageRef, descriptor: MessageSelectionDescriptor) -> Bool {
        if selected.remove(reference) != nil {
            descriptors.removeValue(forKey: reference)
            return true
        }
        guard selected.count < Self.maximumCount else { return false }
        selected.insert(reference)
        descriptors[reference] = descriptor
        return true
    }
}

enum ChatInteractionMode: Equatable {
    case normal
    case selecting(MessageSelectionState)
}

struct MessageSelectionIndicator: View {
    let isSelected: Bool

    var body: some View {
        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 24, weight: .regular))
            .foregroundColor(isSelected ? AppColors.accent : AppColors.tertiaryText)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .accessibilityLabel(isSelected ? L10n.tr("selection.selected") : L10n.tr("selection.notSelected"))
    }
}

struct ChatSelectionToolbar: View {
    let selectionCount: Int
    let showsForward: Bool
    let onForward: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            if showsForward {
                actionButton(title: L10n.tr("chat.action.forward"), icon: "arrowshape.turn.up.right", action: onForward)
            }
            actionButton(title: L10n.tr("common.delete"), icon: "trash", role: .destructive, action: onDelete)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 58)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) { Divider() }
    }

    private func actionButton(
        title: String,
        icon: String,
        role: ButtonRole? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(role: role, action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 20))
                Text(title).font(.system(size: 12))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(.plain)
        .disabled(selectionCount == 0)
        .opacity(selectionCount == 0 ? 0.35 : 1)
    }
}

struct MessageMenuTarget: Equatable {
    let messageID: Int?
    let pendingID: String?
    let anchorFrame: CGRect
    let actions: [MessageMenuAction]

    init(messageID: Int, anchorFrame: CGRect, actions: [MessageMenuAction]) {
        self.messageID = messageID
        self.pendingID = nil
        self.anchorFrame = anchorFrame
        self.actions = actions
    }

    init(pendingID: String, anchorFrame: CGRect, actions: [MessageMenuAction]) {
        self.messageID = nil
        self.pendingID = pendingID
        self.anchorFrame = anchorFrame
        self.actions = actions
    }
}

enum ChatTimelineOrdering {
    static func merge<Item>(
        _ left: [Item],
        _ right: [Item],
        precedes: (Item, Item) -> Bool
    ) -> [Item] {
        var result: [Item] = []
        result.reserveCapacity(left.count + right.count)
        var leftIndex = 0
        var rightIndex = 0
        while leftIndex < left.count && rightIndex < right.count {
            if precedes(right[rightIndex], left[leftIndex]) {
                result.append(right[rightIndex])
                rightIndex += 1
            } else {
                result.append(left[leftIndex])
                leftIndex += 1
            }
        }
        if leftIndex < left.count {
            result.append(contentsOf: left[leftIndex...])
        }
        if rightIndex < right.count {
            result.append(contentsOf: right[rightIndex...])
        }
        return result
    }

    static func precedes(
        date lhsDate: Date?,
        stableID lhsID: String,
        date rhsDate: Date?,
        stableID rhsID: String
    ) -> Bool {
        let lhs = lhsDate ?? .distantPast
        let rhs = rhsDate ?? .distantPast
        if lhs == rhs { return lhsID < rhsID }
        return lhs < rhs
    }
}

struct WeChatMessageActionOverlay: View {
    let target: MessageMenuTarget
    let onSelect: (MessageMenuAction) -> Void
    let onDismiss: () -> Void

    private let itemWidth: CGFloat = 58
    private let itemHeight: CGFloat = 56
    private let menuPadding: CGFloat = 6
    private let pointerSize = CGSize(width: 14, height: 7)

    var body: some View {
        GeometryReader { proxy in
            let containerFrame = proxy.frame(in: .global)
            let anchor = target.anchorFrame.offsetBy(
                dx: -containerFrame.minX,
                dy: -containerFrame.minY
            )
            let columnCount = min(max(target.actions.count, 1), 4)
            let menuWidth = CGFloat(columnCount) * itemWidth + menuPadding * 2
            let rowCount = max(1, Int(ceil(Double(target.actions.count) / 4.0)))
            let menuBodyHeight = CGFloat(rowCount) * itemHeight + menuPadding * 2
            let totalHeight = menuBodyHeight + pointerSize.height
            let horizontalInset: CGFloat = 10
            let bubbleGap: CGFloat = 4
            let topLimit = max(proxy.safeAreaInsets.top, 8) + 6
            let bottomLimit = proxy.size.height - max(proxy.safeAreaInsets.bottom, 8) - 6
            let horizontalCenter = min(max(
                anchor.midX,
                menuWidth / 2 + horizontalInset
            ), proxy.size.width - menuWidth / 2 - horizontalInset)
            let roomAbove = anchor.minY - topLimit
            let roomBelow = bottomLimit - anchor.maxY
            let opensAbove = roomAbove >= totalHeight + bubbleGap || roomAbove >= roomBelow
            let idealCenterY = opensAbove
                ? anchor.minY - totalHeight / 2 - bubbleGap
                : anchor.maxY + totalHeight / 2 + bubbleGap
            let menuCenterY = min(max(
                idealCenterY,
                topLimit + totalHeight / 2
            ), bottomLimit - totalHeight / 2)
            let pointerX = min(max(
                anchor.midX - (horizontalCenter - menuWidth / 2),
                18
            ), menuWidth - 18)

            ZStack(alignment: .topLeading) {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture(perform: onDismiss)

                VStack(spacing: 0) {
                    if !opensAbove {
                        pointerRow(
                            pointerX: pointerX,
                            menuWidth: menuWidth,
                            pointsDown: false
                        )
                    }

                    LazyVGrid(
                        columns: Array(
                            repeating: GridItem(.fixed(itemWidth), spacing: 0),
                            count: min(max(target.actions.count, 1), 4)
                        ),
                        spacing: 0
                    ) {
                        ForEach(target.actions, id: \.self) { action in
                            Button {
                                onSelect(action)
                            } label: {
                                VStack(spacing: 5) {
                                    Image(systemName: action.systemImage)
                                        .font(.system(size: 20, weight: .regular))
                                    Text(action.title)
                                        .font(.system(size: 11, weight: .regular))
                                        .lineLimit(1)
                                }
                                .foregroundColor(.white)
                                .frame(width: itemWidth, height: itemHeight)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(action.title)
                        }
                    }
                    .padding(.horizontal, menuPadding)
                    .padding(.vertical, menuPadding)
                    .background(Color(red: 0.24, green: 0.24, blue: 0.25))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .shadow(color: .black.opacity(0.18), radius: 5, x: 0, y: 2)

                    if opensAbove {
                        pointerRow(
                            pointerX: pointerX,
                            menuWidth: menuWidth,
                            pointsDown: true
                        )
                    }
                }
                .frame(width: menuWidth, height: totalHeight)
                .position(x: horizontalCenter, y: menuCenterY)
                .transition(.scale(scale: 0.92, anchor: opensAbove ? .bottom : .top).combined(with: .opacity))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .ignoresSafeArea(.container, edges: .all)
        .ignoresSafeArea(.keyboard, edges: .all)
        .accessibilityAddTraits(.isModal)
    }

    private func pointerRow(
        pointerX: CGFloat,
        menuWidth: CGFloat,
        pointsDown: Bool
    ) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: max(pointerX - pointerSize.width / 2, 0))
            MessageMenuPointer()
                .fill(Color(red: 0.24, green: 0.24, blue: 0.25))
                .frame(width: pointerSize.width, height: pointerSize.height)
                // Rotate only the triangle. Rotating the whole row mirrors its
                // horizontal coordinate and moves the pointer away from the
                // bubble's midpoint whenever the menu opens above the bubble.
                .rotationEffect(pointsDown ? .degrees(180) : .zero)
            Spacer(minLength: 0)
        }
        .frame(width: menuWidth, height: pointerSize.height)
    }
}

private struct MessageMenuPointer: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: 0))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

enum TimelineLocatorKind: Equatable {
    case mention
    case reply
    case newMessages(Int)
    case bottom

    var title: String? {
        switch self {
        case .mention: return L10n.tr("timeline.mentionedMe")
        case .reply: return L10n.tr("timeline.repliedMe")
        case .newMessages(let count): return L10n.tr("timeline.newMessages", count)
        case .bottom: return nil
        }
    }

    var systemImage: String {
        switch self {
        case .mention: return "at"
        case .reply: return "quote.bubble"
        case .newMessages, .bottom: return "arrow.down"
        }
    }
}

struct ChatTimelineLocatorButton: View {
    let kind: TimelineLocatorKind
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: kind.systemImage)
                    .font(.system(size: 13, weight: .semibold))
                if let title = kind.title {
                    Text(title)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                }
            }
            .foregroundColor(AppColors.accent)
            .padding(.horizontal, kind.title == nil ? 11 : 13)
            .frame(height: 36)
            .background(.ultraThinMaterial)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color.white.opacity(0.8), lineWidth: 1))
            .shadow(color: .black.opacity(0.14), radius: 7, y: 3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(kind.title ?? L10n.tr("timeline.backToLatest"))
    }
}

struct ReplyPreviewBar: View {
    let senderName: String
    let content: String
    let msgType: String
    let onCancel: () -> Void

    var body: some View {
        Group {
            if msgType == "image" {
                ImageReplyReferenceView(
                    senderName: senderName,
                    detailText: L10n.tr("message.image"),
                    style: .composer,
                    onCancel: onCancel
                ) {
                    ChatReplyImageThumbnail(url: content)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
            } else {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(AppColors.accent)
                        .frame(width: 3, height: 36)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(L10n.tr("reply.to", senderName))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(AppColors.accent)
                            .lineLimit(1)

                        Text(previewText)
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }

                    Spacer()

                    Button(action: onCancel) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 18))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
        }
        .background(AppColors.cardBackground.opacity(0.96))
        .overlay(alignment: .top) { Divider() }
    }

    private var previewText: String {
        switch msgType {
        case "image": return L10n.tr("message.image")
        case "video": return L10n.tr("message.video")
        case "voice": return L10n.tr("message.voice")
        case "sticker": return StickerMessagePayload.previewText(content: content, msgType: msgType) ?? L10n.tr("message.sticker")
        case "gift": return GiftMessagePayload.previewText(content: content)
        default: return content
        }
    }
}

/// Quoted message bubble shown inside a message bubble.
struct QuotedMessageView: View {
    let senderName: String
    let content: String
    let msgType: String
    let isFromMe: Bool
    var onTap: (() -> Void)?

    var body: some View {
        Group {
            if msgType == "image" {
                ImageReplyReferenceView(
                    senderName: senderName,
                    detailText: L10n.tr("message.image"),
                    style: .bubble(isFromMe: isFromMe),
                    onTap: onTap
                ) {
                    ChatReplyImageThumbnail(url: content)
                }
            } else {
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(isFromMe ? Color.white : AppColors.accent)
                        .frame(width: 2.5)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(senderName)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(isFromMe ? .white : AppColors.accent)
                            .lineLimit(1)

                        Text(previewText)
                            .font(.system(size: 12))
                            .foregroundColor(isFromMe ? .white : Color(hex: "3A3A50"))
                            .lineLimit(2)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(isFromMe ? Color.black.opacity(0.25) : Color(hex: "DDDDE8"))
                )
                .contentShape(Rectangle())
                .onTapGesture { onTap?() }
            }
        }
    }

    private var previewText: String {
        switch msgType {
        case "image": return L10n.tr("message.image")
        case "video": return L10n.tr("message.video")
        case "voice": return L10n.tr("message.voice")
        case "sticker": return StickerMessagePayload.previewText(content: content, msgType: msgType) ?? L10n.tr("message.sticker")
        case "gift": return GiftMessagePayload.previewText(content: content)
        default: return content
        }
    }
}

enum ImageReplyReferenceStyle: Equatable {
    case composer
    case bubble(isFromMe: Bool)
}

/// Compact WeChat-inspired image quote shared by every conversation type.
struct ImageReplyReferenceView<Thumbnail: View>: View {
    let senderName: String
    let detailText: String
    let style: ImageReplyReferenceStyle
    var onTap: (() -> Void)?
    var onCancel: (() -> Void)?
    private let thumbnail: Thumbnail

    init(
        senderName: String,
        detailText: String,
        style: ImageReplyReferenceStyle,
        onTap: (() -> Void)? = nil,
        onCancel: (() -> Void)? = nil,
        @ViewBuilder thumbnail: () -> Thumbnail
    ) {
        self.senderName = senderName
        self.detailText = detailText
        self.style = style
        self.onTap = onTap
        self.onCancel = onCancel
        self.thumbnail = thumbnail()
    }

    private var isComposer: Bool { style == .composer }
    private var isFromMe: Bool {
        guard case .bubble(let value) = style else { return false }
        return value
    }
    private var thumbnailSize: CGFloat { isComposer ? 44 : 40 }

    @ViewBuilder
    var body: some View {
        if isComposer {
            composerReference
        } else {
            // Mirror the existing text quote: indicator, sender and subdued
            // surface. The quoted content itself is the scaled image only.
            HStack(alignment: .top, spacing: 6) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(indicatorColor)
                    .frame(width: 2.5, height: 75)

                VStack(alignment: .leading, spacing: 4) {
                    Text(senderName)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(titleColor)
                        .lineLimit(1)
                        .frame(width: 56, alignment: .leading)

                    thumbnail
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(thumbnailBorderColor, lineWidth: 0.5)
                        }
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(backgroundColor)
            )
            .contentShape(Rectangle())
            .onTapGesture { onTap?() }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(senderName)，\(detailText)")
        }
    }

    private var composerReference: some View {
        HStack(spacing: 9) {
            RoundedRectangle(cornerRadius: 1)
                .fill(indicatorColor)
                .frame(width: 2, height: thumbnailSize)

            VStack(alignment: .leading, spacing: 3) {
                Text(L10n.tr("reply.to", senderName))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(titleColor)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    Image(systemName: "photo")
                        .font(.system(size: 11, weight: .medium))
                    Text(detailText)
                        .font(.system(size: 13))
                }
                .foregroundColor(detailColor)
                .lineLimit(1)
            }

            Spacer(minLength: 8)

            thumbnail
                .frame(width: thumbnailSize, height: thumbnailSize)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(thumbnailBorderColor, lineWidth: 0.5)
                }

            if let onCancel {
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(width: 28, height: 28)
                        .background(AppColors.separator.opacity(0.72))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("common.cancel"))
            }
        }
        .padding(.leading, 9)
        .padding(.trailing, 8)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(backgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(borderColor, lineWidth: 0.5)
        }
        .contentShape(Rectangle())
        .onTapGesture { onTap?() }
    }

    private var backgroundColor: Color {
        if isComposer { return AppColors.secondaryBackground }
        return isFromMe ? Color.black.opacity(0.16) : AppColors.separator.opacity(0.72)
    }

    private var borderColor: Color {
        if isComposer { return AppColors.separator }
        return isFromMe ? Color.white.opacity(0.12) : AppColors.tertiaryText.opacity(0.16)
    }

    private var indicatorColor: Color {
        if isComposer { return AppColors.tertiaryText.opacity(0.75) }
        return isFromMe ? Color.white.opacity(0.55) : AppColors.tertiaryText.opacity(0.72)
    }

    private var titleColor: Color {
        if isComposer { return AppColors.secondaryText }
        return isFromMe ? Color.white.opacity(0.84) : AppColors.secondaryText
    }

    private var detailColor: Color {
        if isComposer { return AppColors.primaryText.opacity(0.78) }
        return isFromMe ? Color.white.opacity(0.76) : AppColors.primaryText.opacity(0.74)
    }

    private var thumbnailBorderColor: Color {
        isFromMe && !isComposer ? Color.white.opacity(0.18) : Color.black.opacity(0.08)
    }
}

struct ChatReplyImageThumbnail: View {
    let url: String
    @State private var image: UIImage?

    private var cacheKey: String { url + "?thumb=1" }

    init(url: String) {
        self.url = url
        _image = State(initialValue: ImageCacheManager.shared.image(for: url + "?thumb=1"))
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    AppColors.separator
                    Image(systemName: "photo")
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                }
            }
        }
        .clipped()
        .transaction { $0.animation = nil }
        .task(id: cacheKey) {
            let requestedKey = cacheKey
            if let cached = ImageCacheManager.shared.image(for: requestedKey) {
                image = cached
                return
            }
            image = nil
            let loaded = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
            guard !Task.isCancelled, requestedKey == cacheKey else { return }
            image = loaded
        }
    }
}

enum ChatHistoryReplyResolver {
    static func directReply(
        for message: Message,
        messagesByID: [Int: Message]
    ) -> ReplyPreview? {
        if let embedded = message.replyTo { return embedded }
        return directReply(to: message.replyToID, messagesByID: messagesByID)
    }

    static func directReply(
        to replyToID: Int?,
        messagesByID: [Int: Message]
    ) -> ReplyPreview? {
        guard let replyToID,
              let source = messagesByID[replyToID] else { return nil }
        return ReplyPreview(
            id: source.id,
            senderID: source.senderID,
            msgType: source.msgType,
            content: source.content
        )
    }

    static func groupReply(
        for message: GroupMessage,
        messagesByID: [Int: GroupMessage]
    ) -> GroupReplyPreview? {
        if let embedded = message.replyTo { return embedded }
        return groupReply(to: message.replyToID, messagesByID: messagesByID)
    }

    static func groupReply(
        to replyToID: Int?,
        messagesByID: [Int: GroupMessage]
    ) -> GroupReplyPreview? {
        guard let replyToID,
              let source = messagesByID[replyToID] else { return nil }
        return GroupReplyPreview(
            id: source.id,
            senderID: source.senderID,
            msgType: source.msgType,
            content: source.content
        )
    }
}
