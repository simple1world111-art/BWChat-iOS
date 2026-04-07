// BWChat/Components/ReplyPreviewBar.swift
// Compact bar showing the message being replied to

import SwiftUI

struct ReplyPreviewBar: View {
    let senderName: String
    let content: String
    let msgType: String
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(AppColors.accent)
                .frame(width: 3, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text("回复 \(senderName)")
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
        .background(AppColors.separator.opacity(0.8))
    }

    private var previewText: String {
        switch msgType {
        case "image": return "[图片]"
        case "video": return "[视频]"
        default: return content
        }
    }
}

/// Quoted message bubble shown inside a message bubble
struct QuotedMessageView: View {
    let senderName: String
    let content: String
    let msgType: String
    let isFromMe: Bool

    var body: some View {
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
                    .foregroundColor(isFromMe ? .white.opacity(0.9) : Color(hex: "3A3A50"))
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isFromMe ? Color.white.opacity(0.2) : Color(hex: "DDDDE8"))
        )
    }

    private var previewText: String {
        switch msgType {
        case "image": return "[图片]"
        case "video": return "[视频]"
        default: return content
        }
    }
}
