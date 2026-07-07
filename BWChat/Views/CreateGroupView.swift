// BWChat/Views/CreateGroupView.swift
// Create group chat by selecting friends - adaptive layout

import SwiftUI

struct CreateGroupView: View {
    @StateObject private var friendsVM = FriendsViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var groupName = ""
    @State private var selectedFriends: Set<String> = []
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
                // Group name input
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

                // Friends list
                VStack(alignment: .leading, spacing: 8) {
                    Text(L10n.tr("group.selectMembers.count", selectedFriends.count))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                        .textCase(.uppercase)
                        .padding(.horizontal, 16)

                    if friendsVM.friends.isEmpty && !friendsVM.isLoading {
                        VStack(spacing: 12) {
                            Spacer()
                            Image(systemName: "person.3")
                                .font(.system(size: 36))
                                .foregroundColor(AppColors.tertiaryText)
                            Text(L10n.tr("group.create.noFriends"))
                                .font(.system(size: 14))
                                .foregroundColor(AppColors.secondaryText)
                            Spacer()
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 0) {
                                ForEach(friendsVM.friends) { friend in
                                    let isSelected = selectedFriends.contains(friend.userID)
                                    Button {
                                        if isSelected {
                                            selectedFriends.remove(friend.userID)
                                        } else {
                                            selectedFriends.insert(friend.userID)
                                        }
                                    } label: {
                                        HStack(spacing: 12) {
                                            // Selection indicator - bigger hit area
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

                                            AvatarView(url: friend.avatarURL, size: 42)

                                            Text(friend.nickname)
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
                                    Divider().padding(.leading, 76)
                                }
                            }
                        }
                    }
                }

                Spacer(minLength: 0)
            }
            .background(AppColors.background)
            .navigationTitle(L10n.tr("group.create.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
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
        }
        .task {
            await friendsVM.loadFriends()
        }
    }

    private var canCreate: Bool {
        !groupName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !selectedFriends.isEmpty
    }

    private func createGroup() async {
        isCreating = true
        let groupsVM = GroupsViewModel()
        let success = await groupsVM.createGroup(
            name: groupName.trimmingCharacters(in: .whitespacesAndNewlines),
            memberIDs: Array(selectedFriends),
            isPublic: isPublic
        )
        isCreating = false
        if success {
            onCreated?()
            dismiss()
        }
    }
}
