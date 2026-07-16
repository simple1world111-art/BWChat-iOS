// BWChat/Components/AvatarView.swift
// Premium avatar with gradient placeholder

import SwiftUI

struct AvatarView: View {
    let url: String
    let size: CGFloat

    @State private var image: UIImage?

    private var resolvedPath: String {
        Self.resolvedPath(for: url)
    }

    init(url: String, size: CGFloat) {
        self.url = url
        self.size = size

        let path = Self.resolvedPath(for: url)
        let cachedImage = path.isEmpty ? nil : ImageCacheManager.shared.image(for: path)
        _image = State(initialValue: cachedImage)
    }

    private static func resolvedPath(for url: String) -> String {
        MediaURLResolver.resolve(url)?.absoluteString ?? ""
    }

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                // Gradient placeholder
                RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                    .fill(AppColors.accentGradient)
                    .overlay(
                        Image(systemName: "person.fill")
                            .foregroundColor(.white.opacity(0.8))
                            .font(.system(size: size * 0.38, weight: .medium))
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
        .transaction { transaction in
            transaction.animation = nil
        }
        .onAppear {
            // Try synchronous memory cache first for instant display
            let path = resolvedPath
            guard !path.isEmpty else { return }
            if let cached = ImageCacheManager.shared.image(for: path) {
                image = cached
            }
        }
        .task(id: url) {
            let path = resolvedPath
            guard !path.isEmpty else {
                image = nil
                return
            }

            if let cached = ImageCacheManager.shared.image(for: path) {
                image = cached
                return
            }

            // Only clear image if we had one but sync cache no longer has this path
            if image != nil {
                image = nil
            }
            if let loaded = await ImageCacheManager.shared.loadImage(from: path) {
                image = loaded
            }
        }
    }
}

/// Default group-chat artwork shared by lists, shortcuts, and call surfaces.
struct GroupAvatarIcon: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .fill(AppColors.iconBlack)

            RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                .fill(AppColors.iconYellow)
                .padding(max(1.5, size * 0.045))

            Image(systemName: "bubble.left.fill")
                .font(.system(size: size * 0.65, weight: .regular))
                .foregroundStyle(AppColors.iconBlack)
                .offset(y: size * 0.035)

            Image(systemName: "person.3.fill")
                .font(.system(size: size * 0.29, weight: .bold))
                .foregroundStyle(AppColors.iconWhite)
                .offset(y: -size * 0.015)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
    }
}

/// Group-chat avatar composed from three to nine member avatars.
struct GroupMemberAvatarView: View {
    let groupID: Int
    let size: CGFloat

    @State private var avatarURLs: [String]

    private let spacing: CGFloat = 1.5
    private let inset: CGFloat = 3

    init(groupID: Int, size: CGFloat) {
        self.groupID = groupID
        self.size = size
        _avatarURLs = State(initialValue: Self.cachedAvatarURLs(groupID: groupID))
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                .fill(Color(hex: "E5E5EA"))

            VStack(spacing: spacing) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: spacing) {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, url in
                            AvatarView(url: url, size: memberSize)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(inset)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.18, style: .continuous))
        .task(id: groupID) {
            await loadMembers()
        }
    }

    private var displayURLs: [String] {
        var urls = Array(avatarURLs.prefix(9))
        if urls.count < 3 {
            urls.append(contentsOf: Array(repeating: "", count: 3 - urls.count))
        }
        return urls
    }

    private var columnCount: Int {
        displayURLs.count <= 4 ? 2 : 3
    }

    private var memberSize: CGFloat {
        let available = size - inset * 2 - spacing * CGFloat(columnCount - 1)
        return floor(available / CGFloat(columnCount))
    }

    private var rows: [[String]] {
        let urls = displayURLs
        let columns = columnCount
        let firstRowCount = urls.count % columns == 0 ? columns : urls.count % columns
        var result: [[String]] = []
        var start = 0
        var count = firstRowCount
        while start < urls.count {
            let end = min(urls.count, start + count)
            result.append(Array(urls[start..<end]))
            start = end
            count = columns
        }
        return result
    }

    @MainActor
    private func loadMembers() async {
        do {
            let detail: GroupDetail
            if let key = CacheKey.current(namespace: "group-detail", key: "\(groupID)") {
                if let cached: CachedSnapshot<GroupDetail> = AppCacheRepository.shared.cachedValue(for: key) {
                    apply(cached.value.members)
                }
                detail = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .profile,
                    forceRefresh: false
                ) {
                    try await APIService.shared.getGroupDetail(groupID: groupID)
                }
            } else {
                detail = try await APIService.shared.getGroupDetail(groupID: groupID)
            }
            guard !Task.isCancelled else { return }
            apply(detail.members)
        } catch {
            return
        }
    }

    @MainActor
    private func apply(_ members: [GroupMember]) {
        let urls = Array(members.prefix(9).map(\.avatarURL))
        if avatarURLs != urls { avatarURLs = urls }
    }

    private static func cachedAvatarURLs(groupID: Int) -> [String] {
        if let key = CacheKey.current(namespace: "group-detail", key: "\(groupID)"),
           let cached: CachedSnapshot<GroupDetail> = AppCacheRepository.shared.cachedValue(for: key) {
            return Array(cached.value.members.prefix(9).map(\.avatarURL))
        }
        if let legacy = LocalCache.load(GroupDetail.self, key: "group_detail_\(groupID)") {
            return Array(legacy.members.prefix(9).map(\.avatarURL))
        }
        return []
    }
}

struct UserAvatarButton: View {
    @EnvironmentObject private var navigator: UIKitNavigator

    let userID: String
    let avatarURL: String
    let size: CGFloat
    var accessibilityName: String?
    var onLongPress: (() -> Void)?

    @State private var lastOpenAt = Date.distantPast

    var body: some View {
        AvatarView(url: avatarURL, size: size)
            .contentShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            .gesture(
                ExclusiveGesture(
                    LongPressGesture(minimumDuration: 0.45),
                    TapGesture()
                )
                .onEnded { value in
                    switch value {
                    case .first(true):
                        onLongPress?()
                    case .second:
                        openProfile()
                    default:
                        break
                    }
                }
            )
            .accessibilityElement()
            .accessibilityLabel(accessibilityLabel)
            .accessibilityAddTraits(.isButton)
    }

    private var accessibilityLabel: String {
        if let accessibilityName, !accessibilityName.isBlank {
            return L10n.tr("profile.open", accessibilityName)
        }
        return L10n.tr("profile.open.default")
    }

    private func openProfile() {
        let targetID = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !targetID.isEmpty else { return }

        let now = Date()
        guard now.timeIntervalSince(lastOpenAt) > 0.6 else { return }
        lastOpenAt = now

        navigator.push(UserProfileView(userID: targetID))
    }
}
