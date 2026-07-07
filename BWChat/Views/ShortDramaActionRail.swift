// BWChat/Views/ShortDramaActionRail.swift
// Right-side action controls for short drama videos.

import SwiftUI

struct ShortDramaActionRail: View {
    let video: ShortDramaVideo
    let onToggleFollow: () -> Void
    let onToggleLike: () -> Void
    let onToggleFavorite: () -> Void
    let onOpenComments: () -> Void
    let onOpenCreator: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 6) {
                Button(action: onOpenCreator) {
                    AvatarView(url: video.creator.avatarURL, size: 48)
                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                }
                .buttonStyle(.plain)

                if video.creator.userID != AuthManager.shared.currentUser?.userID {
                    Button(action: onToggleFollow) {
                        Image(systemName: video.creator.followedByMe ? "checkmark" : "plus")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.white)
                            .frame(width: 26, height: 26)
                            .background(video.creator.followedByMe ? Color.white.opacity(0.26) : AppColors.errorColor)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(video.creator.followedByMe ? L10n.tr("follow.followingButton") : L10n.tr("follow.followButton"))
                }
            }

            railButton(
                systemImage: video.likedByMe ? "heart.fill" : "heart",
                tint: video.likedByMe ? AppColors.errorColor : .white,
                count: video.likeCount,
                action: onToggleLike,
                label: L10n.tr("shortDrama.like")
            )

            railButton(
                systemImage: video.favoritedByMe ? "bookmark.fill" : "bookmark",
                tint: video.favoritedByMe ? Color(hex: "FFD166") : .white,
                count: video.favoriteCount,
                action: onToggleFavorite,
                label: L10n.tr("shortDrama.favorite")
            )

            railButton(
                systemImage: "text.bubble.fill",
                tint: .white,
                count: video.commentCount,
                action: onOpenComments,
                label: L10n.tr("shortDrama.comments")
            )
        }
        .frame(width: 58)
        .shadow(color: .black.opacity(0.45), radius: 8, x: 0, y: 2)
    }

    private func railButton(
        systemImage: String,
        tint: Color,
        count: Int,
        action: @escaping () -> Void,
        label: String
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(.system(size: 27, weight: .bold))
                    .foregroundColor(tint)
                    .frame(width: 44, height: 34)

                Text(Self.compactCount(count))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .frame(width: 54)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private static func compactCount(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000).replacingOccurrences(of: ".0", with: "")
        }
        if value >= 10_000 {
            return String(format: "%.1fW", Double(value) / 10_000).replacingOccurrences(of: ".0", with: "")
        }
        if value >= 1_000 {
            return String(format: "%.1fK", Double(value) / 1_000).replacingOccurrences(of: ".0", with: "")
        }
        return "\(value)"
    }
}
