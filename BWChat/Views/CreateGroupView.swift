// BWChat/Views/CreateGroupView.swift
// Create a group chat by selecting mutual follows or followers.

import SwiftUI

struct CreateGroupView: View {
    @StateObject private var mutualFollowsVM = GroupMemberSourceViewModel(source: .mutualFollows)
    @StateObject private var followersVM = GroupMemberSourceViewModel(source: .followers)
    @Environment(\.dismiss) private var dismiss
    @State private var groupName = ""
    @State private var selectedMemberIDs: Set<String> = []
    @State private var isPublic: Bool
    @State private var isCreating = false
    var onCreated: (() -> Void)?

    init(initialIsPublic: Bool = false, onCreated: (() -> Void)? = nil) {
        _isPublic = State(initialValue: initialIsPublic)
        self.onCreated = onCreated
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                groupSettings
                memberPicker
                Spacer(minLength: 0)
            }
            .background(AppColors.background)
            .navigationTitle(L10n.tr("group.create.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { createToolbar }
        }
        .task {
            async let mutualFollows: () = mutualFollowsVM.loadInitial()
            async let followers: () = followersVM.loadInitial()
            _ = await (mutualFollows, followers)
        }
    }

    private var groupSettings: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.tr("group.create.name"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .textCase(.uppercase)

                TextField(L10n.tr("group.create.name.placeholder"), text: $groupName)
                    .font(.system(size: 16))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(AppColors.separator.opacity(0.6))
                    .cornerRadius(12)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 8)

            HStack(spacing: 12) {
                Image(systemName: "globe")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundColor(AppColors.accent)
                    .frame(width: 24)

                Text(L10n.tr("group.isPublic"))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)

                Spacer()

                Toggle("", isOn: $isPublic)
                    .labelsHidden()
                    .tint(AppColors.accent)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(AppColors.separator.opacity(0.6))
            .cornerRadius(12)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }

    private var memberPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.tr("group.selectMembers.count", selectedMemberIDs.count))
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .textCase(.uppercase)
                .padding(.horizontal, 16)

            ScrollView {
                LazyVStack(spacing: 0) {
                    followersEntry

                    Text(L10n.tr("follow.relationship.mutual"))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .padding(.bottom, 6)

                    mutualFollowsContent
                }
            }
            .refreshable {
                await mutualFollowsVM.refresh()
                await followersVM.refresh()
            }
        }
    }

    private var followersEntry: some View {
        NavigationLink {
            GroupFollowersSelectionView(
                viewModel: followersVM,
                selectedMemberIDs: $selectedMemberIDs
            )
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(AppColors.accentLight)
                        .frame(width: 42, height: 42)
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                }

                Text(L10n.tr("follow.followers"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)

                Spacer()

                if !selectedMemberIDs.isEmpty {
                    Text("\(selectedMemberIDs.count)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                        .padding(.horizontal, 9)
                        .frame(height: 26)
                        .background(Capsule().fill(AppColors.accentLight))
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.tr("follow.followers"))
    }

    @ViewBuilder
    private var mutualFollowsContent: some View {
        if mutualFollowsVM.isLoading && mutualFollowsVM.users.isEmpty {
            ProgressView()
                .tint(AppColors.accent)
                .padding(.top, 36)
        } else if mutualFollowsVM.users.isEmpty {
            GroupMemberEmptyState(
                icon: "person.2",
                title: L10n.tr("group.create.noMutualFollows")
            )
        } else {
            ForEach(mutualFollowsVM.users) { user in
                GroupMemberSelectionRow(
                    user: user,
                    isSelected: selectedMemberIDs.contains(user.userID)
                ) {
                    toggleSelection(user.userID)
                }
                .onAppear {
                    mutualFollowsVM.loadMoreIfNeeded(currentUserID: user.userID)
                }
            }

            if mutualFollowsVM.isLoadingMore {
                ProgressView()
                    .tint(AppColors.accent)
                    .padding(.vertical, 16)
            }
        }
    }

    @ToolbarContentBuilder
    private var createToolbar: some ToolbarContent {
        ToolbarItem(placement: .navigationBarLeading) {
            Button(L10n.tr("common.cancel")) { dismiss() }
                .font(.system(size: 16))
                .foregroundColor(AppColors.accent)
                .frame(height: 44)
                .contentShape(Rectangle())
        }
        ToolbarItem(placement: .navigationBarTrailing) {
            Button {
                Task { await createGroup() }
            } label: {
                if isCreating {
                    ProgressView()
                        .scaleEffect(0.8)
                } else {
                    Text(L10n.tr("common.create"))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(canCreate ? AppColors.accent : AppColors.tertiaryText)
                }
            }
            .disabled(!canCreate || isCreating)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
    }

    private var canCreate: Bool {
        !groupName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !selectedMemberIDs.isEmpty
    }

    private func toggleSelection(_ userID: String) {
        if selectedMemberIDs.contains(userID) {
            selectedMemberIDs.remove(userID)
        } else {
            selectedMemberIDs.insert(userID)
        }
    }

    private func createGroup() async {
        isCreating = true
        let groupsVM = GroupsViewModel()
        let success = await groupsVM.createGroup(
            name: groupName.trimmingCharacters(in: .whitespacesAndNewlines),
            memberIDs: Array(selectedMemberIDs),
            isPublic: isPublic
        )
        isCreating = false
        if success {
            onCreated?()
            dismiss()
        }
    }
}

private struct GroupFollowersSelectionView: View {
    @ObservedObject var viewModel: GroupMemberSourceViewModel
    @Binding var selectedMemberIDs: Set<String>

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if viewModel.isLoading && viewModel.users.isEmpty {
                    ProgressView()
                        .tint(AppColors.accent)
                        .padding(.top, 80)
                } else if viewModel.users.isEmpty {
                    GroupMemberEmptyState(
                        icon: "person.2",
                        title: L10n.tr("follow.followers.empty")
                    )
                    .padding(.top, 36)
                } else {
                    ForEach(viewModel.users) { user in
                        GroupMemberSelectionRow(
                            user: user,
                            isSelected: selectedMemberIDs.contains(user.userID)
                        ) {
                            toggleSelection(user.userID)
                        }
                        .onAppear {
                            viewModel.loadMoreIfNeeded(currentUserID: user.userID)
                        }
                    }

                    if viewModel.isLoadingMore {
                        ProgressView()
                            .tint(AppColors.accent)
                            .padding(.vertical, 16)
                    }
                }
            }
        }
        .background(AppColors.background)
        .navigationTitle(L10n.tr("follow.followers"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Text(L10n.tr("group.selectedMembers.count", selectedMemberIDs.count))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(AppColors.accent)
            }
        }
        .refreshable {
            await viewModel.refresh()
        }
        .task {
            await viewModel.loadInitial()
        }
    }

    private func toggleSelection(_ userID: String) {
        if selectedMemberIDs.contains(userID) {
            selectedMemberIDs.remove(userID)
        } else {
            selectedMemberIDs.insert(userID)
        }
    }
}

private struct GroupMemberSelectionRow: View {
    let user: FollowUser
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .strokeBorder(isSelected ? AppColors.accent : AppColors.tertiaryText, lineWidth: 2)
                        .frame(width: 24, height: 24)
                    if isSelected {
                        Circle()
                            .fill(AppColors.accent)
                            .frame(width: 24, height: 24)
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                .frame(width: 36, height: 36)
                .contentShape(Circle())

                AvatarView(url: user.avatarURL, size: 42)

                Text(user.nickname)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(user.nickname)
        .accessibilityAddTraits(isSelected ? .isSelected : [])

        Divider().padding(.leading, 76)
    }
}

private struct GroupMemberEmptyState: View {
    let icon: String
    let title: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 36))
                .foregroundColor(AppColors.tertiaryText)
            Text(title)
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 42)
    }
}

private enum GroupMemberSource {
    case mutualFollows
    case followers
}

@MainActor
private final class GroupMemberSourceViewModel: ObservableObject {
    @Published private(set) var users: [FollowUser] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false

    private let source: GroupMemberSource
    private var nextPage: Int? = 1
    private var hasLoaded = false

    init(source: GroupMemberSource) {
        self.source = source
    }

    func loadInitial() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        nextPage = 1
        await loadNextPage(showBlockingLoader: users.isEmpty)
    }

    func refresh() async {
        guard !isLoading, !isLoadingMore else { return }
        hasLoaded = true
        nextPage = 1
        users = []
        await loadNextPage(showBlockingLoader: true)
    }

    func loadMoreIfNeeded(currentUserID: String) {
        guard users.last?.userID == currentUserID,
              nextPage != nil,
              !isLoading,
              !isLoadingMore else { return }
        Task { await loadNextPage(showBlockingLoader: false) }
    }

    private func loadNextPage(showBlockingLoader: Bool) async {
        guard nextPage != nil else { return }
        if showBlockingLoader {
            isLoading = true
        } else {
            isLoadingMore = true
        }
        defer {
            isLoading = false
            isLoadingMore = false
        }

        do {
            // Mutual follows can be sparse. Continue across empty filtered pages
            // so the UI does not incorrectly stop before reaching eligible users.
            repeat {
                guard let page = nextPage, !Task.isCancelled else { return }
                let result: FollowUsersPage
                switch source {
                case .mutualFollows:
                    result = try await APIService.shared.getFollowing(page: page)
                case .followers:
                    result = try await APIService.shared.getFollowers(page: page)
                }

                let currentUserID = AuthManager.shared.currentUser?.userID
                let eligibleUsers = result.users.filter { user in
                    guard user.userID != currentUserID else { return false }
                    switch source {
                    case .mutualFollows:
                        return user.followedByMe && user.followsMe
                    case .followers:
                        return true
                    }
                }

                let existingIDs = Set(users.map(\.userID))
                users.append(contentsOf: eligibleUsers.filter { !existingIDs.contains($0.userID) })
                eligibleUsers.forEach {
                    UserCacheManager.shared.cacheUser(
                        userID: $0.userID,
                        username: $0.username,
                        nickname: $0.nickname,
                        avatarURL: $0.avatarURL
                    )
                }

                if result.hasMore {
                    let candidate = result.nextPage ?? page + 1
                    nextPage = candidate > page ? candidate : page + 1
                } else {
                    nextPage = nil
                }

                let shouldStopPaging: Bool
                switch source {
                case .followers:
                    shouldStopPaging = true
                case .mutualFollows:
                    shouldStopPaging = !eligibleUsers.isEmpty
                }
                if shouldStopPaging {
                    break
                }
            } while nextPage != nil
        } catch is CancellationError {
            return
        } catch {
            // Keep any already loaded members visible. Pull to refresh retries.
        }
    }
}
