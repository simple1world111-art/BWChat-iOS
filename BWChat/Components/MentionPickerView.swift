// BWChat/Components/MentionPickerView.swift
// @mention user picker for group chats

import SwiftUI

struct MentionPickerView: View {
    let groupID: Int
    let onSelect: (String, String) -> Void  // (userID, nickname)
    @Environment(\.dismiss) private var dismiss
    @State private var members: [GroupMember] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(members) { member in
                        Button {
                            onSelect(member.userID, member.nickname)
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                AvatarView(url: member.avatarURL, size: 36)
                                Text(member.nickname)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundColor(AppColors.primaryText)
                                Spacer()
                            }
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(L10n.tr("mention.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(L10n.tr("common.cancel")) { dismiss() }
                }
            }
        }
        .task {
            do {
                let detail: GroupDetail
                if let key = CacheKey.current(namespace: "group-detail", key: "\(groupID)") {
                    if let cached: CachedSnapshot<GroupDetail> = AppCacheRepository.shared.cachedValue(for: key) {
                        let myID = AuthManager.shared.currentUser?.userID
                        members = cached.value.members.filter { $0.userID != myID }
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
                let myID = AuthManager.shared.currentUser?.userID
                members = detail.members.filter { $0.userID != myID }
            } catch {}
            isLoading = false
        }
    }
}
