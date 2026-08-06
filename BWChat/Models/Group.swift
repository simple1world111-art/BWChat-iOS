// BWChat/Models/Group.swift
// Data model for group chats

import Foundation
import Combine

struct ChatGroup: Codable, Identifiable, Equatable, Hashable {
    let groupID: Int
    let name: String
    let avatarURL: String
    let creatorID: String
    let memberCount: Int
    let lastMessage: String?
    let lastMessageTime: String?
    let lastMessageSender: String?
    let unreadCount: Int
    let isPublic: Bool
    let isMuted: Bool

    var id: Int { groupID }

    enum CodingKeys: String, CodingKey {
        case id
        case groupID = "group_id"
        case groupIDCamel = "groupID"
        case name
        case avatarURL = "avatar_url"
        case avatarURLCamel = "avatarURL"
        case creatorID = "creator_id"
        case creatorIDCamel = "creatorID"
        case memberCount = "member_count"
        case memberCountCamel = "memberCount"
        case lastMessage = "last_message"
        case lastMessageCamel = "lastMessage"
        case lastMessageTime = "last_message_time"
        case lastMessageTimeCamel = "lastMessageTime"
        case lastMessageSender = "last_message_sender"
        case lastMessageSenderCamel = "lastMessageSender"
        case unreadCount = "unread_count"
        case unread
        case unreadCountCamel = "unreadCount"
        case isPublic = "is_public"
        case isMuted = "is_muted"
    }

    enum AlternateCodingKeys: String, CodingKey {
        case isPublic = "isPublic"
        case isMuted = "isMuted"
    }

    init(
        groupID: Int,
        name: String,
        avatarURL: String,
        creatorID: String,
        memberCount: Int,
        lastMessage: String?,
        lastMessageTime: String?,
        lastMessageSender: String?,
        unreadCount: Int,
        isPublic: Bool = false,
        isMuted: Bool = false
    ) {
        self.groupID = groupID
        self.name = name
        self.avatarURL = avatarURL
        self.creatorID = creatorID
        self.memberCount = memberCount
        self.lastMessage = lastMessage
        self.lastMessageTime = lastMessageTime
        self.lastMessageSender = lastMessageSender
        self.unreadCount = unreadCount
        self.isPublic = isPublic
        self.isMuted = isMuted
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let alternateContainer = try decoder.container(keyedBy: AlternateCodingKeys.self)

        self.groupID = container.flexInt(for: .groupID)
            ?? container.flexInt(for: .groupIDCamel)
            ?? container.flexInt(for: .id)
            ?? 0
        self.name = container.flexString(for: .name) ?? ""
        self.avatarURL = container.flexString(for: .avatarURL)
            ?? container.flexString(for: .avatarURLCamel)
            ?? ""
        self.creatorID = container.flexString(for: .creatorID)
            ?? container.flexString(for: .creatorIDCamel)
            ?? ""
        self.memberCount = container.flexInt(for: .memberCount)
            ?? container.flexInt(for: .memberCountCamel)
            ?? 0
        self.lastMessage = container.flexContent(for: .lastMessage)
            ?? container.flexContent(for: .lastMessageCamel)
        self.lastMessageTime = container.flexString(for: .lastMessageTime)
            ?? container.flexString(for: .lastMessageTimeCamel)
        self.lastMessageSender = container.flexString(for: .lastMessageSender)
            ?? container.flexString(for: .lastMessageSenderCamel)
        self.unreadCount = container.flexInt(for: .unreadCount)
            ?? container.flexInt(for: .unread)
            ?? container.flexInt(for: .unreadCountCamel)
            ?? 0
        self.isPublic = container.flexBool(for: .isPublic)
            ?? alternateContainer.flexBool(for: .isPublic)
            ?? false
        self.isMuted = container.flexBool(for: .isMuted)
            ?? alternateContainer.flexBool(for: .isMuted)
            ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(name, forKey: .name)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encode(creatorID, forKey: .creatorID)
        try container.encode(memberCount, forKey: .memberCount)
        try container.encodeIfPresent(lastMessage, forKey: .lastMessage)
        try container.encodeIfPresent(lastMessageTime, forKey: .lastMessageTime)
        try container.encodeIfPresent(lastMessageSender, forKey: .lastMessageSender)
        try container.encode(unreadCount, forKey: .unreadCount)
        try container.encode(isPublic, forKey: .isPublic)
        try container.encode(isMuted, forKey: .isMuted)
    }

    var formattedTime: String {
        TimestampHelper.formatListTime(lastMessageTime)
    }
}

struct GroupNotificationSettings: Codable, Equatable, Sendable {
    static let importantMemberLimit = 4

    let groupID: Int
    var isMuted: Bool
    var notifyMentionsMe: Bool
    var notifyMentionsAll: Bool
    var importantMemberIDs: [String]
    var revision: Int64
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case groupIDCamel = "groupID"
        case isMuted = "muted"
        case isMutedLegacy = "is_muted"
        case isMutedCamel = "isMuted"
        case notifyMentionsMe = "notify_mentions_me"
        case notifyMentionsMeCamel = "notifyMentionsMe"
        case notifyMentionsAll = "notify_mentions_all"
        case notifyMentionsAllCamel = "notifyMentionsAll"
        case importantMemberIDs = "important_member_ids"
        case importantMemberIDsCamel = "importantMemberIDs"
        case revision
        case updatedAt = "updated_at"
        case updatedAtCamel = "updatedAt"
    }

    init(
        groupID: Int,
        isMuted: Bool = false,
        notifyMentionsMe: Bool = true,
        notifyMentionsAll: Bool = true,
        importantMemberIDs: [String] = [],
        revision: Int64 = 0,
        updatedAt: String? = nil
    ) {
        self.groupID = groupID
        self.isMuted = isMuted
        self.notifyMentionsMe = notifyMentionsMe
        self.notifyMentionsAll = notifyMentionsAll
        self.importantMemberIDs = Self.normalizedMemberIDs(importantMemberIDs)
        self.revision = max(0, revision)
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let groupID = container.flexInt(for: .groupID)
            ?? container.flexInt(for: .groupIDCamel)
            ?? 0
        let isMuted = container.flexBool(for: .isMuted)
            ?? container.flexBool(for: .isMutedLegacy)
            ?? container.flexBool(for: .isMutedCamel)
            ?? false
        let notifyMentionsMe = container.flexBool(for: .notifyMentionsMe)
            ?? container.flexBool(for: .notifyMentionsMeCamel)
            ?? true
        let notifyMentionsAll = container.flexBool(for: .notifyMentionsAll)
            ?? container.flexBool(for: .notifyMentionsAllCamel)
            ?? true
        let importantMemberIDs = container.flexStringArray(for: .importantMemberIDs)
            ?? container.flexStringArray(for: .importantMemberIDsCamel)
            ?? []
        let revision: Int64
        if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            revision = decoded
        } else {
            revision = Int64(container.flexInt(for: .revision) ?? 0)
        }
        self.init(
            groupID: groupID,
            isMuted: isMuted,
            notifyMentionsMe: notifyMentionsMe,
            notifyMentionsAll: notifyMentionsAll,
            importantMemberIDs: importantMemberIDs,
            revision: revision,
            updatedAt: container.flexString(for: .updatedAt)
                ?? container.flexString(for: .updatedAtCamel)
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(isMuted, forKey: .isMuted)
        try container.encode(notifyMentionsMe, forKey: .notifyMentionsMe)
        try container.encode(notifyMentionsAll, forKey: .notifyMentionsAll)
        try container.encode(importantMemberIDs, forKey: .importantMemberIDs)
        try container.encode(revision, forKey: .revision)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }

    func replacing(
        isMuted: Bool? = nil,
        notifyMentionsMe: Bool? = nil,
        notifyMentionsAll: Bool? = nil,
        importantMemberIDs: [String]? = nil
    ) -> GroupNotificationSettings {
        GroupNotificationSettings(
            groupID: groupID,
            isMuted: isMuted ?? self.isMuted,
            notifyMentionsMe: notifyMentionsMe ?? self.notifyMentionsMe,
            notifyMentionsAll: notifyMentionsAll ?? self.notifyMentionsAll,
            importantMemberIDs: importantMemberIDs ?? self.importantMemberIDs,
            revision: revision,
            updatedAt: updatedAt
        )
    }

    func retainingValidMembers(_ validMemberIDs: Set<String>) -> GroupNotificationSettings {
        replacing(importantMemberIDs: importantMemberIDs.filter(validMemberIDs.contains))
    }

    func shouldAlert(
        senderID: String?,
        isDirectMention: Bool,
        isMentionAll: Bool
    ) -> Bool {
        if !isMuted { return true }
        if isDirectMention && notifyMentionsMe { return true }
        if isMentionAll && notifyMentionsAll { return true }
        if let senderID, importantMemberIDs.contains(senderID) { return true }
        return false
    }

    private static func normalizedMemberIDs(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty, seen.insert(normalized).inserted else { return nil }
            return normalized
        }
        .prefix(importantMemberLimit)
        .map { $0 }
    }
}

struct GroupViewerSettings: Codable, Equatable, Sendable {
    let groupID: Int
    var remark: String
    var showMemberNicknames: Bool
    var clearedBeforeSequence: Int64?
    var revision: Int64
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case groupIDCamel = "groupID"
        case remark
        case groupRemark = "group_remark"
        case showMemberNicknames = "show_member_nicknames"
        case showMemberNicknamesCamel = "showMemberNicknames"
        case clearedBeforeSequence = "cleared_before_sequence"
        case clearedBeforeSequenceCamel = "clearedBeforeSequence"
        case revision
        case updatedAt = "updated_at"
        case updatedAtCamel = "updatedAt"
    }

    init(
        groupID: Int,
        remark: String = "",
        showMemberNicknames: Bool = true,
        clearedBeforeSequence: Int64? = nil,
        revision: Int64 = 0,
        updatedAt: String? = nil
    ) {
        self.groupID = groupID
        self.remark = remark
        self.showMemberNicknames = showMemberNicknames
        self.clearedBeforeSequence = clearedBeforeSequence
        self.revision = max(0, revision)
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let groupID = container.flexInt(for: .groupID)
            ?? container.flexInt(for: .groupIDCamel)
            ?? 0
        let revision: Int64
        if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            revision = decoded
        } else {
            revision = Int64(container.flexInt(for: .revision) ?? 0)
        }
        let clearedBeforeSequence: Int64?
        if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .clearedBeforeSequence) {
            clearedBeforeSequence = decoded
        } else if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .clearedBeforeSequenceCamel) {
            clearedBeforeSequence = decoded
        } else {
            clearedBeforeSequence = container.flexInt(for: .clearedBeforeSequence).map(Int64.init)
                ?? container.flexInt(for: .clearedBeforeSequenceCamel).map(Int64.init)
        }
        self.init(
            groupID: groupID,
            remark: container.flexString(for: .remark)
                ?? container.flexString(for: .groupRemark)
                ?? "",
            showMemberNicknames: container.flexBool(for: .showMemberNicknames)
                ?? container.flexBool(for: .showMemberNicknamesCamel)
                ?? true,
            clearedBeforeSequence: clearedBeforeSequence,
            revision: revision,
            updatedAt: container.flexString(for: .updatedAt)
                ?? container.flexString(for: .updatedAtCamel)
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(remark, forKey: .remark)
        try container.encode(showMemberNicknames, forKey: .showMemberNicknames)
        try container.encodeIfPresent(clearedBeforeSequence, forKey: .clearedBeforeSequence)
        try container.encode(revision, forKey: .revision)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }

    func replacing(
        remark: String? = nil,
        showMemberNicknames: Bool? = nil,
        clearedBeforeSequence: Int64? = nil
    ) -> GroupViewerSettings {
        GroupViewerSettings(
            groupID: groupID,
            remark: remark ?? self.remark,
            showMemberNicknames: showMemberNicknames ?? self.showMemberNicknames,
            clearedBeforeSequence: clearedBeforeSequence ?? self.clearedBeforeSequence,
            revision: revision,
            updatedAt: updatedAt
        )
    }
}

struct GroupAnnouncement: Codable, Equatable, Identifiable, Sendable {
    let announcementID: String
    let groupID: Int
    var title: String
    var content: String
    let updatedByID: String?
    let updatedByNickname: String?
    let revision: Int64
    let updatedAt: String?

    var id: String { announcementID.isEmpty ? "group-\(groupID)-announcement" : announcementID }

    enum CodingKeys: String, CodingKey {
        case announcementID = "announcement_id"
        case id
        case groupID = "group_id"
        case title
        case content
        case updatedByID = "updated_by_id"
        case updatedByNickname = "updated_by_nickname"
        case revision
        case updatedAt = "updated_at"
    }

    init(
        announcementID: String = "",
        groupID: Int,
        title: String = "",
        content: String = "",
        updatedByID: String? = nil,
        updatedByNickname: String? = nil,
        revision: Int64 = 0,
        updatedAt: String? = nil
    ) {
        self.announcementID = announcementID
        self.groupID = groupID
        self.title = title
        self.content = content
        self.updatedByID = updatedByID
        self.updatedByNickname = updatedByNickname
        self.revision = revision
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let revision: Int64
        if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            revision = decoded
        } else {
            revision = Int64(container.flexInt(for: .revision) ?? 0)
        }
        self.init(
            announcementID: container.flexString(for: .announcementID)
                ?? container.flexString(for: .id)
                ?? "",
            groupID: container.flexInt(for: .groupID) ?? 0,
            title: container.flexString(for: .title) ?? "",
            content: container.flexString(for: .content) ?? "",
            updatedByID: container.flexString(for: .updatedByID),
            updatedByNickname: container.flexString(for: .updatedByNickname),
            revision: revision,
            updatedAt: container.flexString(for: .updatedAt)
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(announcementID, forKey: .announcementID)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(title, forKey: .title)
        try container.encode(content, forKey: .content)
        try container.encodeIfPresent(updatedByID, forKey: .updatedByID)
        try container.encodeIfPresent(updatedByNickname, forKey: .updatedByNickname)
        try container.encode(revision, forKey: .revision)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }
}

struct GroupCapabilities: Codable, Equatable, Sendable {
    let canManageMembers: Bool
    let canEditGroup: Bool
    let canEditAnnouncement: Bool
    let canCreateInvite: Bool
    let canChangeVisibility: Bool
    let canDismissGroup: Bool

    enum CodingKeys: String, CodingKey {
        case canManageMembers = "can_manage_members"
        case canEditGroup = "can_edit_group"
        case canEditAnnouncement = "can_edit_announcement"
        case canCreateInvite = "can_create_invite"
        case canChangeVisibility = "can_change_visibility"
        case canDismissGroup = "can_dismiss_group"
    }

    init(
        canManageMembers: Bool = false,
        canEditGroup: Bool = false,
        canEditAnnouncement: Bool = false,
        canCreateInvite: Bool = false,
        canChangeVisibility: Bool = false,
        canDismissGroup: Bool = false
    ) {
        self.canManageMembers = canManageMembers
        self.canEditGroup = canEditGroup
        self.canEditAnnouncement = canEditAnnouncement
        self.canCreateInvite = canCreateInvite
        self.canChangeVisibility = canChangeVisibility
        self.canDismissGroup = canDismissGroup
    }
}

struct GroupDetail: Codable, Equatable {
    let groupID: Int
    let name: String
    let avatarURL: String
    let creatorID: String
    let members: [GroupMember]
    var isPublic: Bool
    var notificationSettings: GroupNotificationSettings
    var viewerSettings: GroupViewerSettings
    var announcement: GroupAnnouncement?
    let currentMember: GroupMember?
    let capabilities: GroupCapabilities
    let serverDisplayName: String?

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case name
        case avatarURL = "avatar_url"
        case creatorID = "creator_id"
        case members
        case isPublic = "is_public"
        case notificationSettings = "notification_settings"
        case viewerSettings = "viewer_settings"
        case announcement
        case currentMember = "current_member"
        case capabilities = "permissions"
        case capabilitiesAlternate = "capabilities"
        case serverDisplayName = "display_name"
    }

    enum AlternateCodingKeys: String, CodingKey {
        case isPublic = "isPublic"
        case notificationSettings = "notificationSettings"
        case viewerSettings = "viewerSettings"
        case currentMember = "currentMember"
        case serverDisplayName = "displayName"
    }

    init(
        groupID: Int,
        name: String,
        avatarURL: String,
        creatorID: String,
        members: [GroupMember],
        isPublic: Bool = false,
        notificationSettings: GroupNotificationSettings? = nil,
        viewerSettings: GroupViewerSettings? = nil,
        announcement: GroupAnnouncement? = nil,
        currentMember: GroupMember? = nil,
        capabilities: GroupCapabilities? = nil,
        serverDisplayName: String? = nil
    ) {
        self.groupID = groupID
        self.name = name
        self.avatarURL = avatarURL
        self.creatorID = creatorID
        self.members = members
        self.isPublic = isPublic
        self.notificationSettings = notificationSettings
            ?? GroupNotificationSettings(groupID: groupID)
        if let viewerSettings, viewerSettings.groupID != 0 {
            self.viewerSettings = viewerSettings
        } else if let viewerSettings {
            self.viewerSettings = GroupViewerSettings(
                groupID: groupID,
                remark: viewerSettings.remark,
                showMemberNicknames: viewerSettings.showMemberNicknames,
                clearedBeforeSequence: viewerSettings.clearedBeforeSequence,
                revision: viewerSettings.revision,
                updatedAt: viewerSettings.updatedAt
            )
        } else {
            self.viewerSettings = GroupViewerSettings(groupID: groupID)
        }
        self.announcement = announcement
        self.currentMember = currentMember
        self.capabilities = capabilities ?? Self.fallbackCapabilities(
            creatorID: creatorID,
            currentMember: currentMember,
            members: members,
            isPublic: isPublic
        )
        self.serverDisplayName = serverDisplayName
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let alternateContainer = try decoder.container(keyedBy: AlternateCodingKeys.self)

        self.groupID = try container.decode(Int.self, forKey: .groupID)
        self.name = try container.decode(String.self, forKey: .name)
        self.avatarURL = try container.decode(String.self, forKey: .avatarURL)
        self.creatorID = try container.decode(String.self, forKey: .creatorID)
        self.members = try container.decode([GroupMember].self, forKey: .members)
        self.isPublic = container.flexBool(for: .isPublic)
            ?? alternateContainer.flexBool(for: .isPublic)
            ?? false
        self.notificationSettings = (try? container.decodeIfPresent(
            GroupNotificationSettings.self,
            forKey: .notificationSettings
        ))
            ?? (try? alternateContainer.decodeIfPresent(
                GroupNotificationSettings.self,
                forKey: .notificationSettings
            ))
            ?? GroupNotificationSettings(groupID: self.groupID)
        let decodedViewerSettings = (try? container.decodeIfPresent(
            GroupViewerSettings.self,
            forKey: .viewerSettings
        ))
            ?? (try? alternateContainer.decodeIfPresent(
                GroupViewerSettings.self,
                forKey: .viewerSettings
            ))
        if let decodedViewerSettings, decodedViewerSettings.groupID != 0 {
            self.viewerSettings = decodedViewerSettings
        } else if let decodedViewerSettings {
            self.viewerSettings = GroupViewerSettings(
                groupID: self.groupID,
                remark: decodedViewerSettings.remark,
                showMemberNicknames: decodedViewerSettings.showMemberNicknames,
                clearedBeforeSequence: decodedViewerSettings.clearedBeforeSequence,
                revision: decodedViewerSettings.revision,
                updatedAt: decodedViewerSettings.updatedAt
            )
        } else {
            self.viewerSettings = GroupViewerSettings(groupID: self.groupID)
        }
        self.announcement = try? container.decodeIfPresent(
            GroupAnnouncement.self,
            forKey: .announcement
        )
        let decodedCurrentMember = (try? container.decodeIfPresent(
            GroupMember.self,
            forKey: .currentMember
        ))
            ?? (try? alternateContainer.decodeIfPresent(
                GroupMember.self,
                forKey: .currentMember
            ))
        self.currentMember = decodedCurrentMember
        self.capabilities = (try? container.decodeIfPresent(
            GroupCapabilities.self,
            forKey: .capabilities
        ))
            ?? (try? container.decodeIfPresent(
                GroupCapabilities.self,
                forKey: .capabilitiesAlternate
            ))
            ?? Self.fallbackCapabilities(
                creatorID: self.creatorID,
                currentMember: decodedCurrentMember,
                members: self.members,
                isPublic: self.isPublic
            )
        self.serverDisplayName = container.flexString(for: .serverDisplayName)
            ?? alternateContainer.flexString(for: .serverDisplayName)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(name, forKey: .name)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encode(creatorID, forKey: .creatorID)
        try container.encode(members, forKey: .members)
        try container.encode(isPublic, forKey: .isPublic)
        try container.encode(notificationSettings, forKey: .notificationSettings)
        try container.encode(viewerSettings, forKey: .viewerSettings)
        try container.encodeIfPresent(announcement, forKey: .announcement)
        try container.encodeIfPresent(currentMember, forKey: .currentMember)
        try container.encode(capabilities, forKey: .capabilities)
        try container.encodeIfPresent(serverDisplayName, forKey: .serverDisplayName)
    }

    var displayName: String {
        let remark = viewerSettings.remark.trimmingCharacters(in: .whitespacesAndNewlines)
        if !remark.isEmpty { return remark }
        let serverName = serverDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return serverName.isEmpty ? name : serverName
    }

    var resolvedCurrentMember: GroupMember? {
        currentMember
    }

    private static func fallbackCapabilities(
        creatorID: String,
        currentMember: GroupMember?,
        members: [GroupMember],
        isPublic: Bool
    ) -> GroupCapabilities {
        let role = currentMember?.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let isOwner = currentMember?.userID == creatorID || role == "owner"
        let isManager = isOwner || role == "admin"
        return GroupCapabilities(
            canManageMembers: isManager,
            canEditGroup: isManager,
            canEditAnnouncement: isManager,
            canCreateInvite: isPublic || isManager,
            canChangeVisibility: isOwner,
            canDismissGroup: isOwner
        )
    }
}

struct GroupMember: Codable, Identifiable, Equatable, Hashable {
    let userID: String
    let nickname: String
    let avatarURL: String
    let role: String
    let groupNickname: String?

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case role
        case groupNickname = "group_nickname"
        case groupNicknameCamel = "groupNickname"
    }

    init(
        userID: String,
        nickname: String,
        avatarURL: String,
        role: String = "member",
        groupNickname: String? = nil
    ) {
        self.userID = userID
        self.nickname = nickname
        self.avatarURL = avatarURL
        self.role = role
        self.groupNickname = groupNickname
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let userID = container.flexString(for: .userID) ?? ""
        self.init(
            userID: userID,
            nickname: container.flexString(for: .nickname) ?? userID,
            avatarURL: container.flexString(for: .avatarURL) ?? "",
            role: container.flexString(for: .role) ?? "member",
            groupNickname: container.flexString(for: .groupNickname)
                ?? container.flexString(for: .groupNicknameCamel)
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(userID, forKey: .userID)
        try container.encode(nickname, forKey: .nickname)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encode(role, forKey: .role)
        try container.encodeIfPresent(groupNickname, forKey: .groupNickname)
    }

    var displayNickname: String {
        let group = groupNickname?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !group.isEmpty { return group }
        let profile = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        return profile.isEmpty ? userID : profile
    }
}

struct GroupReplyPreview: Codable, Equatable {
    let id: Int
    let senderID: String
    let msgType: String
    let content: String

    enum CodingKeys: String, CodingKey {
        case id
        case senderID = "sender_id"
        case msgType = "msg_type"
        case content
    }
}

struct GroupMessageScriptContext: Codable, Equatable {
    let roomID: String
    let roleID: String
    let actorType: ScriptActorType
    let turnID: String

    enum CodingKeys: String, CodingKey {
        case roomID = "room_id"
        case roleID = "role_id"
        case actorType = "actor_type"
        case turnID = "turn_id"
    }
}

struct GroupMessage: Codable, Identifiable, Equatable {
    let id: Int
    let groupID: Int
    let senderID: String
    let msgType: String
    let content: String
    let timestamp: String
    let senderNickname: String
    let senderAvatar: String
    let replyToID: Int?
    let replyTo: GroupReplyPreview?
    let mentions: [String]?
    let mentionAll: Bool
    let clientMessageID: String?
    let scriptContext: GroupMessageScriptContext?
    let historySequence: Int64?
    let version: Int
    let updatedAt: String?
    let thumbnailURL: String?

    enum CodingKeys: String, CodingKey {
        case id
        case messageID = "message_id"
        case messageId = "messageId"
        case msgID = "msg_id"
        case msgId = "msgId"
        case groupID = "group_id"
        case groupId = "groupId"
        case senderID = "sender_id"
        case senderId = "senderId"
        case fromUserID = "from_user_id"
        case fromUserId = "fromUserId"
        case userID = "user_id"
        case msgType = "msg_type"
        case msgTypeCamel = "msgType"
        case messageType = "message_type"
        case type
        case content
        case gift
        case payload
        case timestamp
        case createdAt = "created_at"
        case createdAtCamel = "createdAt"
        case time
        case senderNickname = "sender_nickname"
        case senderNicknameCamel = "senderNickname"
        case nickname
        case senderAvatar = "sender_avatar"
        case senderAvatarCamel = "senderAvatar"
        case avatarURL = "avatar_url"
        case replyToID = "reply_to_id"
        case replyToId = "replyToId"
        case replyTo = "reply_to"
        case replyToCamel = "replyTo"
        case mentions
        case mentionAll = "mention_all"
        case mentionAllCamel = "mentionAll"
        case clientMessageID = "client_message_id"
        case clientMessageId = "clientMessageId"
        case clientID = "client_id"
        case clientId = "clientId"
        case scriptContext = "script_context"
        case scriptContextCamel = "scriptContext"
        case historySequence = "history_sequence"
        case historySequenceCamel = "historySequence"
        case version
        case updatedAt = "updated_at"
        case thumbnailURL = "thumbnail_url"
        case thumbnailURLCamel = "thumbnailURL"
        case previewURL = "preview_url"
        case previewURLCamel = "previewURL"
        case status
        case isRecalled = "is_recalled"
        case isRecalledCamel = "isRecalled"
        case recalledAt = "recalled_at"
        case recalledAtCamel = "recalledAt"
    }

    init(
        id: Int,
        groupID: Int,
        senderID: String,
        msgType: String,
        content: String,
        timestamp: String,
        senderNickname: String,
        senderAvatar: String,
        replyToID: Int?,
        replyTo: GroupReplyPreview?,
        mentions: [String]?,
        mentionAll: Bool = false,
        clientMessageID: String? = nil,
        scriptContext: GroupMessageScriptContext? = nil,
        historySequence: Int64? = nil,
        version: Int = 1,
        updatedAt: String? = nil,
        thumbnailURL: String?
    ) {
        self.id = id
        self.groupID = groupID
        self.senderID = senderID
        self.msgType = msgType
        self.content = content
        self.timestamp = timestamp
        self.senderNickname = senderNickname
        self.senderAvatar = senderAvatar
        self.replyToID = replyToID
        self.replyTo = replyTo
        self.mentions = mentions
        self.mentionAll = mentionAll
        self.clientMessageID = clientMessageID
        self.scriptContext = scriptContext
        self.historySequence = historySequence
        self.version = version
        self.updatedAt = updatedAt
        self.thumbnailURL = thumbnailURL?.chatMediaNonEmpty
    }

    init(
        id: Int,
        groupID: Int,
        senderID: String,
        msgType: String,
        content: String,
        timestamp: String,
        senderNickname: String,
        senderAvatar: String,
        replyToID: Int?,
        replyTo: GroupReplyPreview?,
        mentions: [String]?,
        mentionAll: Bool = false,
        clientMessageID: String? = nil,
        scriptContext: GroupMessageScriptContext? = nil,
        historySequence: Int64? = nil,
        version: Int = 1,
        updatedAt: String? = nil
    ) {
        self.init(
            id: id,
            groupID: groupID,
            senderID: senderID,
            msgType: msgType,
            content: content,
            timestamp: timestamp,
            senderNickname: senderNickname,
            senderAvatar: senderAvatar,
            replyToID: replyToID,
            replyTo: replyTo,
            mentions: mentions,
            mentionAll: mentionAll,
            clientMessageID: clientMessageID,
            scriptContext: scriptContext,
            historySequence: historySequence,
            version: version,
            updatedAt: updatedAt,
            thumbnailURL: nil
        )
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedContent = container.flexContent(for: .content)
            ?? container.flexContent(for: .payload)
            ?? container.flexContent(for: .gift)
            ?? ""
        let decodedType = container.flexString(for: .msgType)
            ?? container.flexString(for: .msgTypeCamel)
            ?? container.flexString(for: .messageType)
            ?? container.flexString(for: .type)
            ?? (GiftMessagePayload.parse(decodedContent) == nil ? "text" : "gift")
        let decodedSenderID = container.flexString(for: .senderID)
            ?? container.flexString(for: .senderId)
            ?? container.flexString(for: .fromUserID)
            ?? container.flexString(for: .fromUserId)
            ?? container.flexString(for: .userID)
            ?? ""

        self.id = container.flexInt(for: .id)
            ?? container.flexInt(for: .messageID)
            ?? container.flexInt(for: .messageId)
            ?? container.flexInt(for: .msgID)
            ?? container.flexInt(for: .msgId)
            ?? 0
        self.groupID = container.flexInt(for: .groupID)
            ?? container.flexInt(for: .groupId)
            ?? 0
        self.senderID = decodedSenderID
        let recalledAt = container.flexString(for: .recalledAt)
            ?? container.flexString(for: .recalledAtCamel)
        self.msgType = ChatMessageRecallState.normalizedType(
            messageType: decodedType,
            status: container.flexString(for: .status),
            isRecalled: container.flexBool(for: .isRecalled)
                ?? container.flexBool(for: .isRecalledCamel),
            recalledAt: recalledAt
        )
        self.content = decodedContent
        self.timestamp = container.flexString(for: .timestamp)
            ?? container.flexString(for: .createdAt)
            ?? container.flexString(for: .createdAtCamel)
            ?? container.flexString(for: .time)
            ?? ISO8601DateFormatter().string(from: Date())
        self.senderNickname = container.flexString(for: .senderNickname)
            ?? container.flexString(for: .senderNicknameCamel)
            ?? container.flexString(for: .nickname)
            ?? decodedSenderID
        self.senderAvatar = container.flexString(for: .senderAvatar)
            ?? container.flexString(for: .senderAvatarCamel)
            ?? container.flexString(for: .avatarURL)
            ?? ""
        self.replyToID = container.flexInt(for: .replyToID)
            ?? container.flexInt(for: .replyToId)
        self.replyTo = (try? container.decodeIfPresent(GroupReplyPreview.self, forKey: .replyTo))
            ?? (try? container.decodeIfPresent(GroupReplyPreview.self, forKey: .replyToCamel))
        self.mentions = container.flexStringArray(for: .mentions)
        self.mentionAll = container.flexBool(for: .mentionAll)
            ?? container.flexBool(for: .mentionAllCamel)
            ?? false
        self.clientMessageID = container.flexString(for: .clientMessageID)
            ?? container.flexString(for: .clientMessageId)
            ?? container.flexString(for: .clientID)
            ?? container.flexString(for: .clientId)
        self.scriptContext = (try? container.decodeIfPresent(GroupMessageScriptContext.self, forKey: .scriptContext))
            ?? (try? container.decodeIfPresent(GroupMessageScriptContext.self, forKey: .scriptContextCamel))
        if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .historySequence) {
            self.historySequence = decoded
        } else if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .historySequenceCamel) {
            self.historySequence = decoded
        } else {
            self.historySequence = container.flexInt(for: .historySequence).map(Int64.init)
                ?? container.flexInt(for: .historySequenceCamel).map(Int64.init)
        }
        self.version = container.flexInt(for: .version) ?? 1
        self.updatedAt = container.flexString(for: .updatedAt)
        self.thumbnailURL = (
            container.flexString(for: .thumbnailURL)
                ?? container.flexString(for: .thumbnailURLCamel)
                ?? container.flexString(for: .previewURL)
                ?? container.flexString(for: .previewURLCamel)
        )?.chatMediaNonEmpty
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(senderID, forKey: .senderID)
        try container.encode(msgType, forKey: .msgType)
        try container.encode(content, forKey: .content)
        try container.encode(timestamp, forKey: .timestamp)
        try container.encode(senderNickname, forKey: .senderNickname)
        try container.encode(senderAvatar, forKey: .senderAvatar)
        try container.encodeIfPresent(replyToID, forKey: .replyToID)
        try container.encodeIfPresent(replyTo, forKey: .replyTo)
        try container.encodeIfPresent(mentions, forKey: .mentions)
        try container.encode(mentionAll, forKey: .mentionAll)
        try container.encodeIfPresent(clientMessageID, forKey: .clientMessageID)
        try container.encodeIfPresent(scriptContext, forKey: .scriptContext)
        try container.encodeIfPresent(historySequence, forKey: .historySequence)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encodeIfPresent(thumbnailURL, forKey: .thumbnailURL)
    }

    var isImage: Bool { msgType == "image" }
    var isVideo: Bool { msgType == "video" }
    var isVoice: Bool { msgType == "voice" }
    var isSystem: Bool { msgType == "system" }
    var isRecalled: Bool {
        msgType == ChatMessageRecallState.recalledMessageType
            || (isSystem && content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var callRecord: CallRecordContent? {
        CallRecordContent.parse(content)
    }

    var voiceURL: String? {
        guard isVoice else { return nil }
        return content.components(separatedBy: "|").first
    }

    var voiceDuration: Double {
        guard isVoice, let durStr = content.components(separatedBy: "|").last else { return 0 }
        return Double(durStr) ?? 0
    }

    var formattedTime: String {
        TimestampHelper.formatTime(timestamp)
    }
}

extension GroupMessage {
    /// WebSocket delivery may omit client_message_id even when the HTTP send
    /// included it. Preserve the local identity so acknowledgement updates the
    /// existing bubble instead of creating a replacement view.
    func inheritingClientMessageID(_ fallback: String?) -> GroupMessage {
        let resolvedID = ChatTimelineIdentity.resolvedClientMessageID(
            primary: clientMessageID,
            fallback: fallback
        )
        guard resolvedID != clientMessageID else { return self }
        return GroupMessage(
            id: id,
            groupID: groupID,
            senderID: senderID,
            msgType: msgType,
            content: content,
            timestamp: timestamp,
            senderNickname: senderNickname,
            senderAvatar: senderAvatar,
            replyToID: replyToID,
            replyTo: replyTo,
            mentions: mentions,
            mentionAll: mentionAll,
            clientMessageID: resolvedID,
            scriptContext: scriptContext,
            historySequence: historySequence,
            version: version,
            updatedAt: updatedAt,
            thumbnailURL: thumbnailURL
        )
    }
}

struct GroupInvite: Decodable, Equatable, Identifiable, Sendable {
    let inviteID: String
    let groupID: Int
    let inviteURL: String
    let expiresAt: String
    let createdAt: String?
    let revokedAt: String?

    var id: String { inviteID }

    enum CodingKeys: String, CodingKey {
        case inviteID = "invite_id"
        case id
        case groupID = "group_id"
        case inviteURL = "invite_url"
        case url
        case expiresAt = "expires_at"
        case createdAt = "created_at"
        case revokedAt = "revoked_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        inviteID = container.flexString(for: .inviteID)
            ?? container.flexString(for: .id)
            ?? ""
        groupID = container.flexInt(for: .groupID) ?? 0
        inviteURL = container.flexString(for: .inviteURL)
            ?? container.flexString(for: .url)
            ?? ""
        expiresAt = container.flexString(for: .expiresAt) ?? ""
        createdAt = container.flexString(for: .createdAt)
        revokedAt = container.flexString(for: .revokedAt)
    }
}

struct GroupInvitePreview: Decodable, Equatable, Sendable {
    let token: String?
    let groupID: Int
    let groupName: String
    let avatarURL: String
    let memberCount: Int
    let inviterNickname: String?
    let expiresAt: String
    let isMember: Bool
    let canJoin: Bool

    enum CodingKeys: String, CodingKey {
        case token
        case groupID = "group_id"
        case groupName = "group_name"
        case name
        case avatarURL = "avatar_url"
        case memberCount = "member_count"
        case inviterNickname = "inviter_nickname"
        case expiresAt = "expires_at"
        case isMember = "is_member"
        case canJoin = "can_join"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        token = container.flexString(for: .token)
        groupID = container.flexInt(for: .groupID) ?? 0
        groupName = container.flexString(for: .groupName)
            ?? container.flexString(for: .name)
            ?? ""
        avatarURL = container.flexString(for: .avatarURL) ?? ""
        memberCount = container.flexInt(for: .memberCount) ?? 0
        inviterNickname = container.flexString(for: .inviterNickname)
        expiresAt = container.flexString(for: .expiresAt) ?? ""
        isMember = container.flexBool(for: .isMember) ?? false
        canJoin = container.flexBool(for: .canJoin) ?? false
    }
}

struct GroupInviteAcceptResult: Decodable, Equatable, Sendable {
    let groupID: Int
    let alreadyMember: Bool

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case alreadyMember = "already_member"
    }
}

struct GroupMessageLocator: Codable, Equatable, Sendable {
    let messageID: Int
    let historySequence: Int64?

    enum CodingKeys: String, CodingKey {
        case messageID = "message_id"
        case historySequence = "history_sequence"
    }
}

struct GroupMessageSearchResult: Decodable, Equatable, Identifiable {
    let message: GroupMessage
    let locator: GroupMessageLocator
    let highlightedText: String?

    var id: Int { locator.messageID }

    enum CodingKeys: String, CodingKey {
        case message
        case locator
        case highlightedText = "highlighted_text"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        message = try container.decode(GroupMessage.self, forKey: .message)
        locator = (try? container.decode(GroupMessageLocator.self, forKey: .locator))
            ?? GroupMessageLocator(messageID: message.id, historySequence: message.historySequence)
        highlightedText = container.flexString(for: .highlightedText)
    }
}

struct GroupMessageSearchPage: Decodable, Equatable {
    let results: [GroupMessageSearchResult]
    let nextCursor: String?
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case results
        case messages
        case nextCursor = "next_cursor"
        case hasMore = "has_more"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        results = (try? container.decode([GroupMessageSearchResult].self, forKey: .results))
            ?? (try? container.decode([GroupMessageSearchResult].self, forKey: .messages))
            ?? []
        nextCursor = container.flexString(for: .nextCursor)
        hasMore = container.flexBool(for: .hasMore) ?? (nextCursor?.isEmpty == false)
    }
}

struct GroupHistoryClearReceipt: Codable, Equatable, Sendable {
    let groupID: Int
    let clearedBeforeSequence: Int64
    let clearedAt: String?
    let revision: Int64

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case clearedBeforeSequence = "cleared_before_sequence"
        case clearedAt = "cleared_at"
        case revision
    }

    init(groupID: Int, clearedBeforeSequence: Int64, clearedAt: String? = nil, revision: Int64 = 0) {
        self.groupID = groupID
        self.clearedBeforeSequence = clearedBeforeSequence
        self.clearedAt = clearedAt
        self.revision = revision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        groupID = container.flexInt(for: .groupID) ?? 0
        if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .clearedBeforeSequence) {
            clearedBeforeSequence = decoded
        } else {
            clearedBeforeSequence = Int64(container.flexInt(for: .clearedBeforeSequence) ?? 0)
        }
        clearedAt = container.flexString(for: .clearedAt)
        if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            revision = decoded
        } else {
            revision = Int64(container.flexInt(for: .revision) ?? 0)
        }
    }
}

struct GroupMemberUpdateEvent: Codable, Equatable {
    let groupID: Int
    let member: GroupMember
    let revision: Int64

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case member
        case revision
    }
}

@MainActor
final class GroupNotificationSettingsStore: ObservableObject {
    static let shared = GroupNotificationSettingsStore()

    @Published private(set) var settingsByGroupID: [Int: GroupNotificationSettings] = [:]
    @Published private(set) var updatingGroupIDs: Set<Int> = []

    private let defaults: UserDefaults
    private var scopeID: String

    private init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.scopeID = Self.currentScopeID
        self.settingsByGroupID = Self.load(defaults: defaults, scopeID: scopeID)
    }

    func settings(for groupID: Int) -> GroupNotificationSettings {
        syncScopeIfNeeded()
        return settingsByGroupID[groupID] ?? GroupNotificationSettings(groupID: groupID)
    }

    func isUpdating(groupID: Int) -> Bool {
        updatingGroupIDs.contains(groupID)
    }

    func apply(_ settings: GroupNotificationSettings, allowOlderRevision: Bool = false) {
        syncScopeIfNeeded()
        guard settings.groupID > 0 else { return }
        if !allowOlderRevision,
           let existing = settingsByGroupID[settings.groupID],
           existing.revision > settings.revision {
            return
        }
        settingsByGroupID[settings.groupID] = settings
        persist()
        syncGlobalBadge(for: settings)
    }

    func applyMutedSummary(groupID: Int, isMuted: Bool) {
        var current = settings(for: groupID)
        guard current.isMuted != isMuted else { return }
        current.isMuted = isMuted
        settingsByGroupID[groupID] = current
        persist()
        syncGlobalBadge(for: current)
    }

    @discardableResult
    func load(groupID: Int) async throws -> GroupNotificationSettings {
        let remote = try await APIService.shared.getGroupNotificationSettings(groupID: groupID)
        apply(remote)
        return settings(for: groupID)
    }

    @discardableResult
    func update(
        groupID: Int,
        isMuted: Bool? = nil,
        notifyMentionsMe: Bool? = nil,
        notifyMentionsAll: Bool? = nil,
        importantMemberIDs: [String]? = nil
    ) async throws -> GroupNotificationSettings {
        syncScopeIfNeeded()
        while updatingGroupIDs.contains(groupID) {
            try Task.checkCancellation()
            await Task.yield()
        }

        let previous = settings(for: groupID)
        let optimistic = previous.replacing(
            isMuted: isMuted,
            notifyMentionsMe: notifyMentionsMe,
            notifyMentionsAll: notifyMentionsAll,
            importantMemberIDs: importantMemberIDs
        )
        settingsByGroupID[groupID] = optimistic
        updatingGroupIDs.insert(groupID)
        persist()
        syncGlobalBadge(for: optimistic)
        defer { updatingGroupIDs.remove(groupID) }

        do {
            let remote = try await APIService.shared.updateGroupNotificationSettings(
                groupID: groupID,
                isMuted: isMuted,
                notifyMentionsMe: notifyMentionsMe,
                notifyMentionsAll: notifyMentionsAll,
                importantMemberIDs: importantMemberIDs
            )
            apply(remote)
            return settings(for: groupID)
        } catch {
            settingsByGroupID[groupID] = previous
            persist()
            syncGlobalBadge(for: previous)
            throw error
        }
    }

    func resetForCurrentAccount() {
        scopeID = Self.currentScopeID
        settingsByGroupID = Self.load(defaults: defaults, scopeID: scopeID)
        updatingGroupIDs.removeAll()
    }

    private func syncScopeIfNeeded() {
        let current = Self.currentScopeID
        guard current != scopeID else { return }
        scopeID = current
        settingsByGroupID = Self.load(defaults: defaults, scopeID: current)
        updatingGroupIDs.removeAll()
    }

    private func persist() {
        let stringKeyed = Dictionary(uniqueKeysWithValues: settingsByGroupID.map {
            (String($0.key), $0.value)
        })
        if let data = try? JSONEncoder().encode(stringKeyed) {
            defaults.set(data, forKey: Self.storageKey(scopeID: scopeID))
        }
    }

    private func syncGlobalBadge(for settings: GroupNotificationSettings) {
        UnreadBadgeStore.shared.setConversationMuted(
            settings.isMuted,
            for: ConversationReadTarget.group(groupID: settings.groupID).listIdentity
        )
    }

    private static func load(
        defaults: UserDefaults,
        scopeID: String
    ) -> [Int: GroupNotificationSettings] {
        guard let data = defaults.data(forKey: storageKey(scopeID: scopeID)),
              let decoded = try? JSONDecoder().decode(
                [String: GroupNotificationSettings].self,
                from: data
              ) else {
            return [:]
        }
        return decoded.reduce(into: [:]) { result, entry in
            guard let groupID = Int(entry.key), groupID > 0 else { return }
            result[groupID] = entry.value
        }
    }

    private static var currentScopeID: String {
        let userID = AuthManager.shared.currentUser?.userID
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return userID.isEmpty ? "anonymous" : userID
    }

    private static func storageKey(scopeID: String) -> String {
        "bbchat.group.notification-settings.v1.\(scopeID)"
    }
}

extension Notification.Name {
    static let groupInfoDidChange = Notification.Name("bbchat.groupInfoDidChange")
    static let groupHistoryCleared = Notification.Name("bbchat.groupHistoryCleared")
}

@MainActor
final class GroupInviteRouteStore: ObservableObject {
    static let shared = GroupInviteRouteStore()

    @Published private(set) var pendingToken: String?

    private init() {}

    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard let token = Self.token(from: url) else { return false }
        pendingToken = token
        return true
    }

    func clear(_ token: String) {
        guard pendingToken == token else { return }
        pendingToken = nil
    }

    static func token(from url: URL) -> String? {
        let scheme = url.scheme?.lowercased() ?? ""
        let components = url.pathComponents.filter { $0 != "/" }
        let candidate: String?
        if scheme == "bwchat", url.host?.lowercased() == "group-invite" {
            candidate = components.first
        } else if scheme == "https" {
            if components.count >= 2, components[0] == "group-invites" {
                candidate = components[1]
            } else if components.count >= 3,
                      components[0] == "join",
                      components[1] == "group" {
                candidate = components[2]
            } else {
                candidate = nil
            }
        } else {
            candidate = nil
        }

        guard let token = candidate?.removingPercentEncoding,
              (8...512).contains(token.count),
              token.unicodeScalars.allSatisfy({
                  CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == "."
              }) else { return nil }
        return token
    }
}

@MainActor
final class GroupInfoPreferencesStore: ObservableObject {
    static let shared = GroupInfoPreferencesStore()

    @Published private(set) var settingsByGroupID: [Int: GroupViewerSettings] = [:]
    @Published private(set) var updatingGroupIDs: Set<Int> = []

    private let defaults: UserDefaults
    private var scopeID: String

    private init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        scopeID = Self.currentScopeID
        settingsByGroupID = Self.load(defaults: defaults, scopeID: scopeID)
    }

    func settings(for groupID: Int) -> GroupViewerSettings {
        syncScopeIfNeeded()
        return settingsByGroupID[groupID] ?? GroupViewerSettings(groupID: groupID)
    }

    func displayName(for groupID: Int, fallback: String) -> String {
        let remark = settings(for: groupID).remark.trimmingCharacters(in: .whitespacesAndNewlines)
        return remark.isEmpty ? fallback : remark
    }

    func isUpdating(groupID: Int) -> Bool {
        updatingGroupIDs.contains(groupID)
    }

    func apply(_ incoming: GroupViewerSettings, allowOlderRevision: Bool = false) {
        syncScopeIfNeeded()
        guard incoming.groupID > 0 else { return }
        if !allowOlderRevision,
           let existing = settingsByGroupID[incoming.groupID],
           existing.revision > incoming.revision {
            return
        }
        settingsByGroupID[incoming.groupID] = incoming
        persist()
        if let sequence = incoming.clearedBeforeSequence {
            MessageStore.shared.applyGroupHistoryClear(
                ownerID: scopeID,
                groupID: incoming.groupID,
                throughSequence: sequence
            )
        }
        NotificationCenter.default.post(
            name: .groupInfoDidChange,
            object: incoming.groupID
        )
    }

    @discardableResult
    func update(
        groupID: Int,
        remark: String? = nil,
        showMemberNicknames: Bool? = nil
    ) async throws -> GroupViewerSettings {
        syncScopeIfNeeded()
        while updatingGroupIDs.contains(groupID) {
            try Task.checkCancellation()
            await Task.yield()
        }

        let previous = settings(for: groupID)
        let optimistic = previous.replacing(
            remark: remark,
            showMemberNicknames: showMemberNicknames
        )
        settingsByGroupID[groupID] = optimistic
        updatingGroupIDs.insert(groupID)
        persist()
        NotificationCenter.default.post(name: .groupInfoDidChange, object: groupID)
        defer { updatingGroupIDs.remove(groupID) }

        guard AppRemoteConfigStore.shared.featureFlags.isEnabled(
            "group_viewer_settings_v1",
            default: false
        ) else {
            return optimistic
        }

        do {
            let remote = try await APIService.shared.updateGroupViewerSettings(
                groupID: groupID,
                remark: remark,
                showMemberNicknames: showMemberNicknames
            )
            let normalized = remote.groupID == 0
                ? GroupViewerSettings(
                    groupID: groupID,
                    remark: remote.remark,
                    showMemberNicknames: remote.showMemberNicknames,
                    clearedBeforeSequence: remote.clearedBeforeSequence,
                    revision: remote.revision,
                    updatedAt: remote.updatedAt
                )
                : remote
            apply(normalized)
            return settings(for: groupID)
        } catch {
            settingsByGroupID[groupID] = previous
            persist()
            NotificationCenter.default.post(name: .groupInfoDidChange, object: groupID)
            throw error
        }
    }

    func applyHistoryClear(_ receipt: GroupHistoryClearReceipt) {
        syncScopeIfNeeded()
        let previous = settings(for: receipt.groupID)
        guard previous.clearedBeforeSequence.map({ $0 <= receipt.clearedBeforeSequence }) ?? true else {
            return
        }
        let updated = GroupViewerSettings(
            groupID: receipt.groupID,
            remark: previous.remark,
            showMemberNicknames: previous.showMemberNicknames,
            clearedBeforeSequence: receipt.clearedBeforeSequence,
            revision: max(previous.revision, receipt.revision),
            updatedAt: receipt.clearedAt ?? previous.updatedAt
        )
        settingsByGroupID[receipt.groupID] = updated
        persist()
        MessageStore.shared.applyGroupHistoryClear(
            ownerID: scopeID,
            groupID: receipt.groupID,
            throughSequence: receipt.clearedBeforeSequence
        )
        NotificationCenter.default.post(name: .groupHistoryCleared, object: receipt)
        NotificationCenter.default.post(name: .groupInfoDidChange, object: receipt.groupID)
    }

    func resetForCurrentAccount() {
        scopeID = Self.currentScopeID
        settingsByGroupID = Self.load(defaults: defaults, scopeID: scopeID)
        updatingGroupIDs.removeAll()
    }

    private func syncScopeIfNeeded() {
        let current = Self.currentScopeID
        guard current != scopeID else { return }
        scopeID = current
        settingsByGroupID = Self.load(defaults: defaults, scopeID: current)
        updatingGroupIDs.removeAll()
    }

    private func persist() {
        let values = Dictionary(uniqueKeysWithValues: settingsByGroupID.map {
            (String($0.key), $0.value)
        })
        if let data = try? JSONEncoder().encode(values) {
            defaults.set(data, forKey: Self.storageKey(scopeID: scopeID))
        }
    }

    private static func load(defaults: UserDefaults, scopeID: String) -> [Int: GroupViewerSettings] {
        guard let data = defaults.data(forKey: storageKey(scopeID: scopeID)),
              let decoded = try? JSONDecoder().decode([String: GroupViewerSettings].self, from: data) else {
            return [:]
        }
        return decoded.reduce(into: [:]) { result, entry in
            guard let groupID = Int(entry.key), groupID > 0 else { return }
            result[groupID] = entry.value
        }
    }

    private static var currentScopeID: String {
        let value = AuthManager.shared.currentUser?.userID
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? "anonymous" : value
    }

    private static func storageKey(scopeID: String) -> String {
        "bbchat.group.viewer-settings.v1.\(scopeID)"
    }
}
