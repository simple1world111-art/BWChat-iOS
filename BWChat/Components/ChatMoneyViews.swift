// BWChat/Components/ChatMoneyViews.swift

import SwiftUI

enum ChatMoneyTheme {
    static let pageBackground = Color(hex: "F7F7F7")
    static let cardOrange = Color(hex: "FA9D3B")
    static let mutedOrange = Color(hex: "F6C58E")
    static let transferAccepted = Color(hex: "078A45")
    static let transferReturned = Color(hex: "7F7F7F")
    static let actionRed = Color(hex: "FA5151")
    static let disabledRed = Color(hex: "F3B5B5")
    static let actionGreen = Color(hex: "07C160")
    static let envelopeRed = Color(hex: "D95940")
    static let envelopeDarkRed = Color(hex: "C94B38")
    static let gold = Color(hex: "F4D49B")
    static let secondary = Color(hex: "7F7F7F")
    static let separator = Color(hex: "E5E5E5")
}

enum ChatMoneyErrorText {
    static func message(
        for error: Error,
        kind: ChatMoneyKind? = nil,
        limits: ChatMoneyLimits? = nil
    ) -> String {
        let machineCode: String?
        if case let APIError.serverError(_, message) = error {
            machineCode = message
        } else {
            machineCode = nil
        }

        switch machineCode {
        case "chat_money_insufficient_balance":
            return L10n.tr("gift.insufficientBalance")
        case "chat_money_amount_out_of_range":
            let resolvedKind = kind ?? .redPacket
            let minimum = limits?.minimumAmount(for: resolvedKind) ?? 1
            let maximum = limits?.maximumAmount(for: resolvedKind) ?? 20_000
            return L10n.tr("chatMoney.validation.amount", minimum, maximum)
        case "red_packet_count_out_of_range":
            return L10n.tr("chatMoney.validation.count", limits?.maximumPacketCount ?? 100)
        case "red_packet_total_too_small":
            return L10n.tr("chatMoney.validation.minimumPerPacket")
        case "red_packet_already_claimed":
            return L10n.tr("chatMoney.redPacket.alreadyClaimed")
        case "red_packet_empty":
            return L10n.tr("chatMoney.redPacket.empty")
        case "red_packet_expired":
            return L10n.tr("chatMoney.redPacket.expired")
        case "red_packet_recipient_only":
            return L10n.tr("chatMoney.redPacket.exclusiveOnly")
        case "red_packet_not_conversation_member":
            return L10n.tr("chatMoney.redPacket.notConversationMember")
        case "transfer_recipient_only":
            return L10n.tr("chatMoney.transfer.readOnly")
        case "transfer_already_finalized":
            return L10n.tr("chatMoney.transfer.alreadyFinalized")
        case "chat_money_idempotency_conflict":
            return L10n.tr("chatMoney.operationInProgress")
        default:
            return (error as? LocalizedError)?.errorDescription
                ?? L10n.tr("chatMoney.operationFailed")
        }
    }
}

struct ChatMoneyRecipient: Identifiable, Hashable {
    let id: String
    let name: String
    let avatarURL: String
}

struct ChatMoneyConversationContext: Equatable {
    let scope: ChatMoneyScope
    let receiverID: String?
    let groupID: Int?
    let title: String
    let avatarURL: String
    let members: [ChatMoneyRecipient]

    static func direct(id: String, name: String, avatarURL: String) -> ChatMoneyConversationContext {
        ChatMoneyConversationContext(
            scope: .direct,
            receiverID: id,
            groupID: nil,
            title: name,
            avatarURL: avatarURL,
            members: [ChatMoneyRecipient(id: id, name: name, avatarURL: avatarURL)]
        )
    }

    static func group(id: Int, name: String, members: [GroupMember]) -> ChatMoneyConversationContext {
        ChatMoneyConversationContext(
            scope: .group,
            receiverID: nil,
            groupID: id,
            title: name,
            avatarURL: "",
            members: members.map {
                ChatMoneyRecipient(id: $0.userID, name: $0.nickname, avatarURL: $0.avatarURL)
            }
        )
    }
}

enum ChatMoneyBubblePresentationPolicy {
    static func isMuted(
        payload: ChatMoneyPayload,
        hasViewerClaimedRedPacket: Bool
    ) -> Bool {
        payload.status.isTerminal
            || (payload.kind == .redPacket && hasViewerClaimedRedPacket)
    }
}

struct ChatMoneyPlusMenuTile: View {
    let kind: ChatMoneyKind
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(AppColors.composerPanelIconBackground)
                    .frame(width: 56, height: 56)
                    .overlay {
                        if kind == .redPacket {
                            ChatMoneyRedPacketMenuGlyph()
                        } else {
                            Image(systemName: "arrow.left.arrow.right")
                                .font(.system(size: 22))
                                .foregroundColor(AppColors.primaryText)
                        }
                    }

                Text(kind == .redPacket
                     ? L10n.tr("chatMoney.redPacket")
                     : L10n.tr("chatMoney.transfer"))
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.secondaryText)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("chatMoney.plus.\(kind.rawValue)")
    }
}

private struct ChatMoneyRedPacketMenuGlyph: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(AppColors.primaryText)
                .frame(width: 23, height: 28)

            RedPacketMenuFlap()
                .stroke(AppColors.composerPanelIconBackground, lineWidth: 1.5)
                .frame(width: 21, height: 7)
                .offset(y: -7)

            Circle()
                .fill(AppColors.composerPanelIconBackground)
                .frame(width: 9, height: 9)
                .overlay {
                    Image(systemName: "yensign")
                        .font(.system(size: 5, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                }
                .offset(y: 3)
        }
        .frame(width: 26, height: 28)
    }
}

private struct RedPacketMenuFlap: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.midX, y: rect.maxY)
        )
        return path
    }
}

struct ChatMoneyBubble: View {
    let payload: ChatMoneyPayload
    let isFromMe: Bool
    var senderName: String?
    var hasViewerClaimedRedPacket = false
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            cardContent
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("chatMoney.bubble.\(payload.assetID)")
    }

    @ViewBuilder
    private var cardContent: some View {
        if payload.kind == .redPacket {
            redPacketCard
        } else {
            transferCard
        }
    }

    private var redPacketCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 13) {
                ChatMoneyCardGlyph(kind: .redPacket, transferStatus: nil)

                Text(primaryTitle)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundColor(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 13)
            .frame(height: 78)

            Rectangle()
                .fill(Color.white.opacity(0.22))
                .frame(height: 0.5)
                .padding(.horizontal, 10)

            HStack {
                Text(L10n.tr("chatMoney.redPacket.brand"))
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.88))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 11)
            .frame(height: 28)
        }
        .frame(width: 245)
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private var transferCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ChatMoneyCardGlyph(kind: .transfer, transferStatus: payload.status)

                VStack(alignment: .leading, spacing: 5) {
                    Text(primaryTitle)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                        .lineLimit(1)

                    Text(secondaryTitle)
                        .font(.system(size: 12))
                        .foregroundColor(.white.opacity(0.86))
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 13)
            .frame(height: 74)
            .background(cardBackground)

            HStack(spacing: 8) {
                Text(L10n.tr("chatMoney.transfer.brand"))
                    .font(.system(size: 10))
                    .foregroundColor(Color(hex: "999999"))

                Spacer(minLength: 0)

                if let footerPrompt {
                    Text(footerPrompt.text)
                        .font(
                            .system(
                                size: 11,
                                weight: footerPrompt.tone == .action ? .medium : .regular
                            )
                        )
                        .foregroundColor(
                            footerPrompt.tone == .action
                                ? ChatMoneyTheme.actionRed
                                : Color(hex: "999999")
                        )
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(Color.white)
        }
        .frame(width: 245)
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }

    private var primaryTitle: String {
        if payload.kind == .transfer {
            return L10n.tr("chatMoney.amountValue", payload.amount ?? 0)
        }
        if payload.mode == .exclusive, let name = payload.recipientName {
            return L10n.tr("chatMoney.redPacket.for", name)
        }
        return payload.greeting?.isBlank == false
            ? payload.greeting!
            : L10n.tr("chatMoney.redPacket.defaultGreeting")
    }

    private var secondaryTitle: String {
        if payload.kind == .transfer, payload.status.isTerminal {
            return ChatMoneyMessagePromptResolver.prompt(
                for: payload,
                viewerID: AuthManager.shared.currentUser?.userID,
                isFromMe: isFromMe
            ).text
        }
        guard payload.status == .pending || payload.status == .partial else {
            return payload.status.localizedTitle
        }
        if payload.kind == .transfer {
            if let note = payload.note, !note.isBlank { return note }
            if let name = payload.recipientName {
                return L10n.tr("chatMoney.transfer.to", name)
            }
            return L10n.tr("chatMoney.status.pending")
        }
        if payload.status == .partial {
            return L10n.tr("chatMoney.status.partial")
        }
        return L10n.tr("chatMoney.redPacket.openPrompt")
    }

    private var cardBackground: Color {
        return ChatMoneyBubblePresentationPolicy.isMuted(
            payload: payload,
            hasViewerClaimedRedPacket: hasViewerClaimedRedPacket
        )
            ? ChatMoneyTheme.mutedOrange
            : ChatMoneyTheme.cardOrange
    }

    private var footerPrompt: ChatMoneyMessagePrompt? {
        guard !payload.status.isTerminal else { return nil }
        return ChatMoneyMessagePromptResolver.prompt(
            for: payload,
            viewerID: AuthManager.shared.currentUser?.userID,
            isFromMe: isFromMe
        )
    }
}

struct ChatMoneyReceiptTip: View {
    let payload: ChatMoneyReceiptPayload

    var body: some View {
        HStack(spacing: 6) {
            if let statusIcon {
                Image(systemName: statusIcon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(statusColor)
                    .accessibilityHidden(true)
            }

            Text(payload.localizedText)
                .font(.system(size: 12))
                .foregroundColor(statusColor)
        }
            .padding(.horizontal, 11)
            .padding(.vertical, 5)
            .background(statusBackground)
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 3)
            .accessibilityIdentifier("chatMoney.receipt.\(payload.eventID)")
    }

    private var statusIcon: String? {
        switch payload.eventType {
        case .transferAccepted:
            return "checkmark.circle.fill"
        case .transferReturned, .assetExpiredRefunded:
            return "arrow.uturn.backward.circle.fill"
        case .redPacketClaimed:
            return nil
        }
    }

    private var statusColor: Color {
        switch payload.eventType {
        case .transferAccepted:
            return ChatMoneyTheme.transferAccepted
        case .transferReturned, .assetExpiredRefunded:
            return ChatMoneyTheme.transferReturned
        case .redPacketClaimed:
            return Color(hex: "999999")
        }
    }

    private var statusBackground: Color {
        switch payload.eventType {
        case .transferAccepted:
            return ChatMoneyTheme.transferAccepted.opacity(0.1)
        case .transferReturned, .assetExpiredRefunded:
            return ChatMoneyTheme.transferReturned.opacity(0.1)
        case .redPacketClaimed:
            return Color.black.opacity(0.06)
        }
    }
}

private struct ChatMoneyCardGlyph: View {
    let kind: ChatMoneyKind
    let transferStatus: ChatMoneyStatus?

    var body: some View {
        ZStack {
            if kind == .redPacket {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(ChatMoneyTheme.envelopeDarkRed)
                    .frame(width: 42, height: 48)
                Circle()
                    .fill(ChatMoneyTheme.gold)
                    .frame(width: 17, height: 17)
                    .overlay {
                        Image(systemName: "pawprint.fill")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(ChatMoneyTheme.envelopeDarkRed)
                    }
            } else {
                Circle()
                    .stroke(transferGlyphColor, lineWidth: 2)
                    .frame(width: 42, height: 42)
                Image(systemName: transferGlyphName)
                    .font(.system(size: 19, weight: .medium))
                    .foregroundColor(transferGlyphColor)
            }
        }
        .frame(width: 44, height: 48)
    }

    private var transferGlyphName: String {
        switch transferStatus {
        case .accepted:
            return "checkmark"
        case .returned, .expiredRefunded:
            return "arrow.uturn.backward"
        default:
            return "arrow.left.arrow.right"
        }
    }

    private var transferGlyphColor: Color {
        switch transferStatus {
        case .accepted, .returned, .expiredRefunded:
            return .white
        default:
            return Color(hex: "F8D9A0")
        }
    }
}

#if DEBUG
private struct ChatMoneyViewsPreview: View {
    var body: some View {
        VStack(spacing: 24) {
            ChatMoneyBubble(
                payload: ChatMoneyPayload(
                    assetID: "preview-red",
                    kind: .redPacket,
                    scope: .direct,
                    mode: .direct,
                    senderID: "me",
                    greeting: "恭喜发财，大吉大利"
                ),
                isFromMe: true,
                onTap: {}
            )
            ChatMoneyBubble(
                payload: ChatMoneyPayload(
                    assetID: "preview-red-claimed",
                    kind: .redPacket,
                    scope: .group,
                    mode: .lucky,
                    senderID: "friend",
                    greeting: "已领取的红包",
                    status: .partial
                ),
                isFromMe: false,
                hasViewerClaimedRedPacket: true,
                onTap: {}
            )
            ChatMoneyBubble(
                payload: transferPayload(status: .pending),
                isFromMe: true,
                onTap: {}
            )
            ChatMoneyBubble(
                payload: transferPayload(status: .accepted),
                isFromMe: true,
                onTap: {}
            )
            ChatMoneyBubble(
                payload: transferPayload(status: .returned),
                isFromMe: true,
                onTap: {}
            )
            HStack(spacing: 20) {
                ChatMoneyPlusMenuTile(kind: .redPacket, action: {})
                ChatMoneyPlusMenuTile(kind: .transfer, action: {})
            }
        }
        .padding()
        .background(ChatMoneyTheme.pageBackground)
    }

    private func transferPayload(status: ChatMoneyStatus) -> ChatMoneyPayload {
        ChatMoneyPayload(
            assetID: "preview-transfer-\(status.rawValue)",
            kind: .transfer,
            scope: .direct,
            senderID: "me",
            recipientID: "friend",
            recipientName: "朋友",
            note: "金币转账",
            amount: 100,
            status: status
        )
    }
}

private struct ChatMoneyViews_Previews: PreviewProvider {
    static var previews: some View {
        ChatMoneyViewsPreview()
    }
}
#endif
