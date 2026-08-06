// BWChat/Components/MentionPickerView.swift
// WeChat-style @mention member picker and mention editing model.

import SwiftUI

enum MentionKind: String, Codable, Hashable {
    case direct
    case all
}

struct MentionSpan: Codable, Hashable {
    var userID: String?
    var kind: MentionKind
    var locationUTF16: Int
    var lengthUTF16: Int

    var range: NSRange {
        NSRange(location: locationUTF16, length: lengthUTF16)
    }
}

struct ComposerDocument: Codable, Equatable {
    var text: String = ""
    var mentions: [MentionSpan] = []

    var mentionedUserIDs: [String] {
        Array(Set(mentions.compactMap { span in
            span.kind == .direct ? span.userID : nil
        })).sorted()
    }

    var mentionsAll: Bool {
        mentions.contains(where: { $0.kind == .all })
    }
}

struct MentionSelection: Identifiable, Hashable {
    let userID: String?
    let nickname: String
    let kind: MentionKind

    var id: String {
        kind == .all ? "mention:all" : "mention:\(userID ?? nickname)"
    }
}

enum MentionTextEditing {
    static func inserting(
        _ selections: [MentionSelection],
        replacing replacementRange: NSRange?,
        in document: ComposerDocument,
        selectedRange: NSRange
    ) -> (document: ComposerDocument, selectedRange: NSRange) {
        var next = document
        var cursor = selectedRange
        let firstRange = replacementRange ?? selectedRange

        for (index, selection) in selections.enumerated() {
            let range = index == 0 ? firstRange : cursor
            let token = "@\(selection.nickname) "
            next = replacing(range: range, with: token, in: next)
            cursor = NSRange(
                location: range.location + (token as NSString).length,
                length: 0
            )

            let mentionLength = max((token as NSString).length - 1, 1)
            next.mentions.append(MentionSpan(
                userID: selection.userID,
                kind: selection.kind,
                locationUTF16: range.location,
                lengthUTF16: mentionLength
            ))
            next.mentions.sort { $0.locationUTF16 < $1.locationUTF16 }
        }
        return (next, cursor)
    }

    static func applyingUserEdit(
        range: NSRange,
        replacementText: String,
        to document: ComposerDocument
    ) -> (document: ComposerDocument, selectedRange: NSRange, handledAtomically: Bool) {
        let source = document.text as NSString
        let deletesOneCharacter = replacementText.isEmpty && range.length == 1
        let deletedCharacter = range.location < source.length
            ? source.substring(with: range)
            : ""
        let deletesMentionSeparator = deletesOneCharacter
            && deletedCharacter.rangeOfCharacter(from: .whitespacesAndNewlines) != nil

        let intersecting = document.mentions.filter { span in
            NSIntersectionRange(span.range, range).length > 0
                || (range.length == 0 && NSLocationInRange(range.location, span.range))
                || (deletesMentionSeparator && range.location == NSMaxRange(span.range))
        }
        let expandedRange = intersecting.reduce(range) { partial, span in
            NSUnionRange(partial, span.range)
        }
        let next = replacing(range: expandedRange, with: replacementText, in: document)
        let cursor = NSRange(
            location: expandedRange.location + (replacementText as NSString).length,
            length: 0
        )
        return (next, cursor, !intersecting.isEmpty)
    }

    static func isStandaloneAtInsertion(text: String, range: NSRange, replacement: String) -> Bool {
        guard replacement == "@" else { return false }
        guard range.location > 0 else { return true }
        let source = text as NSString
        guard range.location <= source.length else { return false }
        let previous = source.substring(with: NSRange(location: range.location - 1, length: 1))
        return previous.rangeOfCharacter(from: .whitespacesAndNewlines) != nil
    }

    private static func replacing(
        range: NSRange,
        with replacementText: String,
        in document: ComposerDocument
    ) -> ComposerDocument {
        let source = document.text as NSString
        let safeLocation = min(max(range.location, 0), source.length)
        let safeLength = min(max(range.length, 0), source.length - safeLocation)
        let safeRange = NSRange(location: safeLocation, length: safeLength)
        let replacementLength = (replacementText as NSString).length
        let delta = replacementLength - safeRange.length

        var spans: [MentionSpan] = []
        for var span in document.mentions {
            if NSIntersectionRange(span.range, safeRange).length > 0
                || (safeRange.length == 0 && NSLocationInRange(safeRange.location, span.range)) {
                continue
            }
            if span.locationUTF16 >= NSMaxRange(safeRange) {
                span.locationUTF16 += delta
            }
            spans.append(span)
        }

        return ComposerDocument(
            text: source.replacingCharacters(in: safeRange, with: replacementText),
            mentions: spans
        )
    }
}

enum MentionMemberResolver {
    static func visibleMembers(
        from members: [GroupMember],
        excludingUserID: String?
    ) -> [GroupMember] {
        let excludedID = excludingUserID?.trimmingCharacters(in: .whitespacesAndNewlines)
        var membersByID: [String: GroupMember] = [:]

        for member in members {
            let userID = member.userID.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !userID.isEmpty, userID != excludedID else { continue }

            let candidate = GroupMember(
                userID: userID,
                nickname: normalizedNickname(member.nickname, fallback: userID),
                avatarURL: member.avatarURL,
                role: normalizedRole(member.role)
            )
            guard let existing = membersByID[userID] else {
                membersByID[userID] = candidate
                continue
            }

            membersByID[userID] = GroupMember(
                userID: userID,
                nickname: preferredNickname(
                    existing.nickname,
                    candidate.nickname,
                    fallback: userID
                ),
                avatarURL: preferredNonBlank(existing.avatarURL, candidate.avatarURL),
                role: preferredRole(existing.role, candidate.role)
            )
        }

        return membersByID.values.sorted {
            let nicknameOrder = $0.nickname.localizedCaseInsensitiveCompare($1.nickname)
            if nicknameOrder == .orderedSame {
                return $0.userID.localizedCaseInsensitiveCompare($1.userID) == .orderedAscending
            }
            return nicknameOrder == .orderedAscending
        }
    }

    private static func normalizedNickname(_ nickname: String, fallback: String) -> String {
        let value = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? fallback : value
    }

    private static func normalizedRole(_ role: String) -> String {
        let value = role.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "member" : value
    }

    private static func preferredNickname(
        _ existing: String,
        _ candidate: String,
        fallback: String
    ) -> String {
        if existing == fallback, candidate != fallback {
            return candidate
        }
        return existing
    }

    private static func preferredNonBlank(_ existing: String, _ candidate: String) -> String {
        existing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? candidate : existing
    }

    private static func preferredRole(_ existing: String, _ candidate: String) -> String {
        if existing == "member", candidate != "member" {
            return candidate
        }
        return existing
    }
}

struct MentionPickerView: View {
    let groupID: Int
    var allowsMentionAll = false
    let onSelect: ([MentionSelection]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var members: [GroupMember] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var isMultiSelecting = false
    @State private var selectedIDs: Set<String> = []

    init(
        groupID: Int,
        allowsMentionAll: Bool = false,
        initialMembers: [GroupMember] = [],
        onSelect: @escaping ([MentionSelection]) -> Void
    ) {
        self.groupID = groupID
        self.allowsMentionAll = allowsMentionAll
        self.onSelect = onSelect
        let visibleMembers = MentionMemberResolver.visibleMembers(
            from: initialMembers,
            excludingUserID: AuthManager.shared.currentUser?.userID
        )
        _members = State(initialValue: visibleMembers)
        _isLoading = State(initialValue: visibleMembers.isEmpty)
    }

    private var filteredMembers: [GroupMember] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return members }
        return members.filter {
            $0.nickname.localizedCaseInsensitiveContains(query)
                || $0.userID.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && members.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, members.isEmpty {
                    VStack(spacing: 14) {
                        Image(systemName: "exclamationmark.arrow.triangle.2.circlepath")
                            .font(.system(size: 32))
                            .foregroundColor(AppColors.secondaryText)
                        Text(errorMessage)
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                            .multilineTextAlignment(.center)
                        Button(L10n.tr("common.retry")) {
                            Task { await loadMembers(forceRefresh: true) }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppColors.accent)
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if allowsMentionAll && searchText.isBlank {
                            mentionAllRow
                        }

                        ForEach(filteredMembers) { member in
                            memberRow(member)
                        }
                    }
                    .listStyle(.plain)
                    .refreshable { await loadMembers(forceRefresh: true) }
                    .overlay {
                        if filteredMembers.isEmpty && !searchText.isBlank {
                            Text(L10n.tr("mention.noResults"))
                                .font(.system(size: 14))
                                .foregroundColor(AppColors.secondaryText)
                        }
                    }
                }
            }
            .navigationTitle(L10n.tr("mention.title"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: L10n.tr("mention.search"))
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(L10n.tr("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(isMultiSelecting ? L10n.tr("common.done") : L10n.tr("mention.multiSelect")) {
                        if isMultiSelecting {
                            finishMultiSelection()
                        } else {
                            isMultiSelecting = true
                        }
                    }
                    .disabled(isMultiSelecting && selectedIDs.isEmpty)
                }
            }
        }
        .task { await loadMembers(forceRefresh: false) }
    }

    private var mentionAllRow: some View {
        Button {
            select(MentionSelection(userID: nil, nickname: L10n.tr("mention.all"), kind: .all))
        } label: {
            HStack(spacing: 12) {
                Circle()
                    .fill(AppColors.accent.opacity(0.14))
                    .frame(width: 38, height: 38)
                    .overlay(
                        Image(systemName: "person.3.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(AppColors.accent)
                    )
                Text(L10n.tr("mention.all"))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                Spacer()
                selectionIndicator(id: "mention:all")
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func memberRow(_ member: GroupMember) -> some View {
        Button {
            select(MentionSelection(userID: member.userID, nickname: member.nickname, kind: .direct))
        } label: {
            HStack(spacing: 12) {
                AvatarView(url: member.avatarURL, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(member.nickname)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.primaryText)
                    if member.nickname != member.userID {
                        Text(member.userID)
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                }
                Spacer()
                selectionIndicator(id: "mention:\(member.userID)")
            }
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func selectionIndicator(id: String) -> some View {
        if isMultiSelecting {
            Image(systemName: selectedIDs.contains(id) ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 21))
                .foregroundColor(selectedIDs.contains(id) ? AppColors.accent : AppColors.tertiaryText)
        }
    }

    private func select(_ selection: MentionSelection) {
        if isMultiSelecting {
            if selectedIDs.contains(selection.id) {
                selectedIDs.remove(selection.id)
            } else {
                selectedIDs.insert(selection.id)
            }
            return
        }
        onSelect([selection])
        dismiss()
    }

    private func finishMultiSelection() {
        var selections: [MentionSelection] = []
        if selectedIDs.contains("mention:all") {
            selections.append(MentionSelection(
                userID: nil,
                nickname: L10n.tr("mention.all"),
                kind: .all
            ))
        }
        selections.append(contentsOf: members.compactMap { member in
            let selection = MentionSelection(
                userID: member.userID,
                nickname: member.nickname,
                kind: .direct
            )
            return selectedIDs.contains(selection.id) ? selection : nil
        })
        guard !selections.isEmpty else { return }
        onSelect(selections)
        dismiss()
    }

    private func loadMembers(forceRefresh: Bool) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let detail: GroupDetail
            if let key = CacheKey.current(namespace: "group-detail", key: "\(groupID)") {
                if !forceRefresh,
                   let cached: CachedSnapshot<GroupDetail> = AppCacheRepository.shared.cachedValue(for: key) {
                    apply(detail: cached.value)
                } else if !forceRefresh,
                          let legacy = LocalCache.load(
                            GroupDetail.self,
                            key: "group_detail_\(groupID)"
                          ) {
                    apply(detail: legacy)
                    AppCacheRepository.shared.save(legacy, for: key, policy: .profile)
                }
                detail = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .profile,
                    forceRefresh: forceRefresh
                ) {
                    try await APIService.shared.getGroupDetail(groupID: groupID)
                }
            } else {
                detail = try await APIService.shared.getGroupDetail(groupID: groupID)
            }
            apply(detail: detail)
        } catch is CancellationError {
            return
        } catch {
            // Cached or chat-provided members keep @ available even when the
            // background refresh endpoint is temporarily unavailable.
            if members.isEmpty {
                errorMessage = L10n.tr("group.loadFailed")
            }
        }
    }

    private func apply(detail: GroupDetail) {
        members = MentionMemberResolver.visibleMembers(
            from: detail.members,
            excludingUserID: AuthManager.shared.currentUser?.userID
        )
    }
}
