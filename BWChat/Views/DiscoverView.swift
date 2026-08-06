import SwiftUI
import UIKit
import Combine
import PhotosUI

extension Notification.Name {
    static let openLivePairChat = Notification.Name("bbchat.openLivePairChat")
    static let pushLivePairChat = Notification.Name("bbchat.pushLivePairChat")
    static let resetLiveLobbyNavigation = Notification.Name("bbchat.resetLiveLobbyNavigation")
    static let liveHostCallDidEnd = Notification.Name("bbchat.liveHostCallDidEnd")
}

struct DiscoverView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var languageStore = AppLanguageStore.shared
    @ObservedObject private var authManager = AuthManager.shared
    @ObservedObject private var activityInviteRouteStore = ActivityInviteRouteStore.shared
    @StateObject private var momentsNotif = MomentsNotificationManager.shared
    @StateObject private var discoverConfig = DiscoverConfigStore()
    @State private var routeAlert: DynamicRouteAlert?
    @State private var deferredRefreshTask: Task<Void, Never>?
    @State private var hasRunInitialAppearRefresh = false
    @State private var remoteSections: [DiscoverSection]?

    private var displayedSections: [DiscoverSection] {
        if let sections = remoteSections, !sections.isEmpty {
            return sections
        }
        return discoverConfig.sections
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                discoverHeader

                ForEach(displayedSections) { section in
                    discoverCard {
                        ForEach(section.items) { item in
                            discoverRow(for: item, isLast: item.id == section.items.last?.id)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, AppSpacing.rootTabTopInset)
            .padding(.bottom, 20)
        }
        .id(languageStore.activeLanguage.rawValue)
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            updateRemoteSectionsFromAppConfig()
            scheduleDeferredRefresh(forceDiscoverConfig: !hasRunInitialAppearRefresh)
            hasRunInitialAppearRefresh = true
        }
        .onDisappear {
            cancelDeferredWork()
        }
        .onChange(of: authManager.currentUser?.userID ?? "guest") { _ in
            scheduleDeferredRefresh(forceDiscoverConfig: true)
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                scheduleDeferredRefresh(forceDiscoverConfig: false)
            } else {
                cancelDeferredWork()
            }
        }
        .onReceive(activityInviteRouteStore.$pendingToken.compactMap { $0 }) { _ in
            navigator.push(ActivityCenterView())
        }
        .alert(item: $routeAlert) { item in
            Alert(
                title: Text(item.title),
                message: Text(item.message),
                dismissButton: .default(Text(L10n.tr("common.ok")))
            )
        }
    }

    private var discoverHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            RootTabTitle(localizedKey: "tab.discover")
        }
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .center)
        .padding(.bottom, 2)
    }

    @MainActor
    private func updateRemoteSectionsFromAppConfig() {
        let store = AppRemoteConfigStore.shared
        guard store.source != .bundled,
              let sections = store.config.discover?.effectiveSections,
              !sections.isEmpty else {
            remoteSections = nil
            return
        }
        remoteSections = sections
    }

    private func scheduleDeferredRefresh(forceDiscoverConfig: Bool) {
        deferredRefreshTask?.cancel()

        deferredRefreshTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 280_000_000)
            guard !Task.isCancelled else { return }

            await discoverConfig.load(force: forceDiscoverConfig)
            await momentsNotif.fetchFromServer()
            updateRemoteSectionsFromAppConfig()
        }
    }

    private func cancelDeferredWork() {
        deferredRefreshTask?.cancel()
        deferredRefreshTask = nil
    }

    private func discoverRow(for item: DiscoverItem, isLast: Bool) -> some View {
        VStack(spacing: 0) {
            discoverRow(
                title: item.displayTitle(language: languageStore.activeLanguage),
                systemImage: resolvedSystemImage(item.systemImage),
                colors: item.displayColors,
                badge: badgeValue(for: item),
                showsDot: showsDot(for: item)
            ) {
                handleTap(item)
            }

            if !isLast {
                discoverDivider
            }
        }
    }

    @ViewBuilder
    private func discoverCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }

    private func discoverRow(
        title: String,
        systemImage: String,
        colors: [Color],
        badge: Int? = nil,
        showsDot: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(iconFill(for: colors))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Image(systemName: systemImage)
                                .font(.system(size: 17))
                                .foregroundColor(.white)
                        )

                    if showsDot {
                        Circle()
                            .fill(Color.red)
                            .frame(width: 10, height: 10)
                            .offset(x: 3, y: -3)
                    }
                }

                Text(title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                Spacer()

                if let badge, badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.red)
                        .cornerRadius(10)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func iconFill(for colors: [Color]) -> AnyShapeStyle {
        guard let first = colors.first else {
            return AnyShapeStyle(AppColors.accentGradient)
        }
        guard colors.count > 1 else {
            return AnyShapeStyle(first)
        }
        return AnyShapeStyle(LinearGradient(
            colors: Array(colors.prefix(2)),
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        ))
    }

    private func resolvedSystemImage(_ rawName: String?) -> String {
        guard let rawName,
              !rawName.isDiscoverBlank,
              UIImage(systemName: rawName) != nil else {
            return "sparkles"
        }
        return rawName
    }

    private var discoverDivider: some View {
        Rectangle()
            .fill(AppColors.separator)
            .frame(height: 1)
            .padding(.leading, 70)
    }

    private func badgeValue(for item: DiscoverItem) -> Int? {
        if isMomentsEntry(item) {
            return momentsNotif.unreadCount
        }
        switch item.badgeKey?.normalizedDiscoverToken {
        case "moments_unread", "moments":
            return momentsNotif.unreadCount
        default:
            return item.badgeCount
        }
    }

    private func showsDot(for item: DiscoverItem) -> Bool {
        if isMomentsEntry(item) {
            return momentsNotif.hasNewMoments
        }
        switch item.dotKey?.normalizedDiscoverToken {
        case "moments_new", "moments":
            return momentsNotif.hasNewMoments
        default:
            return item.showsDot ?? false
        }
    }

    private func isMomentsEntry(_ item: DiscoverItem) -> Bool {
        item.id.normalizedDiscoverToken == "moments"
            || item.route?.name?.normalizedDiscoverToken == "moments"
    }

    private func handleTap(_ item: DiscoverItem) {
        if item.id.normalizedDiscoverToken == "live" {
            navigator.push(LiveLobbyView())
            return
        }

        // Keep the stable Discover `games` item native even when an older
        // remote config still points it directly at playdot.games.
        let route: DiscoverRoute
        if item.id.normalizedDiscoverToken == "games" {
            route = DiscoverRoute(type: "native", name: "game_center")
        } else if item.id.normalizedDiscoverToken == "stories" {
            // `stories` is the existing Discover entry localized as “剧本”.
            // Keep its identity and placement while upgrading old remote configs
            // that may still mark it as coming soon.
            route = DiscoverRoute(type: "native", name: "script_center")
        } else if item.id.normalizedDiscoverToken == "benefits" {
            // Upgrade legacy remote configurations that still mark the
            // established benefits entry as coming soon.
            route = DiscoverRoute(type: "native", name: "activity_center")
        } else {
            route = item.route ?? DiscoverRoute(type: "native", name: item.id)
        }
        let fallbackTitle = item.displayTitle(language: languageStore.activeLanguage)
        switch DynamicRouteHandler.open(
            DynamicRoute(discoverRoute: route),
            navigator: navigator,
            fallbackTitle: fallbackTitle
        ) {
        case .handled:
            break
        case .alert(let alert):
            routeAlert = alert
        }
    }

}

// MARK: - Live lobby

fileprivate enum LiveLobbyTab: String, CaseIterable, Identifiable {
    case recommended
    case chatted

    var id: String { rawValue }

    var title: String {
        switch self {
        case .recommended: return "推荐"
        case .chatted: return "聊过"
        }
    }
}

private enum LiveLobbyDialog {
    case start
    case exit
    case participant(LiveLobbyParticipant, preferredCallType: CallType?)
}

fileprivate enum LiveLobbyGender: Equatable {
    case male
    case female
    case other
    case unspecified

    init(rawValue: String) {
        switch rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() {
        case "male", "man", "m", "男":
            self = .male
        case "female", "woman", "f", "女":
            self = .female
        case "other", "non_binary", "non-binary":
            self = .other
        default:
            self = .unspecified
        }
    }

    var text: String {
        switch self {
        case .male: return "男"
        case .female: return "女"
        case .other: return "其他"
        case .unspecified: return "保密"
        }
    }

    var symbol: String {
        switch self {
        case .male: return "♂"
        case .female: return "♀"
        case .other: return "•"
        case .unspecified: return "—"
        }
    }

    var color: Color {
        switch self {
        case .male: return Color(hex: "4A90E2")
        case .female: return Color(hex: "FF5D8F")
        case .other: return AppColors.accent
        case .unspecified: return Color(.systemGray)
        }
    }
}

enum LiveLobbyAvailability: Equatable {
    case available
    case inviting
    case busy
    case unknown
    case ended

    init(status: String) {
        switch status
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_") {
        case "waiting", "available", "idle":
            self = .available
        case "inviting", "pending":
            self = .inviting
        case "connecting", "accepted", "in_call", "busy":
            self = .busy
        case "ended", "closed", "cancelled", "canceled":
            self = .ended
        default:
            self = .unknown
        }
    }

    var canReceiveCalls: Bool {
        self == .available
    }

    var isVisibleInLobby: Bool {
        self != .ended
    }

    var sortRank: Int {
        switch self {
        case .available: return 0
        case .inviting, .unknown: return 1
        case .busy: return 2
        case .ended: return 3
        }
    }

    var displayText: String {
        switch self {
        case .available: return "空闲"
        case .inviting: return "邀请中"
        case .busy: return "通话中"
        case .unknown: return "确认中"
        case .ended: return "已结束"
        }
    }

    var detailText: String {
        switch self {
        case .available: return "当前空闲，可以发起连线"
        case .inviting: return "主播正在处理邀请"
        case .busy: return "主播正在连线中"
        case .unknown: return "正在确认主播状态"
        case .ended: return "本次直播已结束"
        }
    }

    var color: Color {
        switch self {
        case .available: return Color(hex: "2DBE70")
        case .inviting, .unknown: return Color(hex: "F4A621")
        case .busy, .ended: return AppColors.errorColor
        }
    }
}

enum LiveLobbySlotPolicy {
    static func isVisible(_ slot: OneToOneLiveSlot) -> Bool {
        !slot.id.isEmpty
            && !slot.user.userID.isEmpty
            && LiveLobbyAvailability(status: slot.status).isVisibleInLobby
    }

    static func sorted(_ slots: [OneToOneLiveSlot]) -> [OneToOneLiveSlot] {
        slots.enumerated()
            .sorted { lhs, rhs in
                let lhsRank = LiveLobbyAvailability(status: lhs.element.status).sortRank
                let rhsRank = LiveLobbyAvailability(status: rhs.element.status).sortRank
                return lhsRank == rhsRank ? lhs.offset < rhs.offset : lhsRank < rhsRank
            }
            .map(\.element)
    }
}

fileprivate struct LiveLobbyParticipant: Identifiable, Equatable {
    let id: String
    let userID: String
    let displayName: String
    let avatarURL: String
    let roleSetting: String
    let allowedCallTypes: [CallType]?
    let gender: LiveLobbyGender
    let availability: LiveLobbyAvailability
    let hasChatted: Bool
    let paletteIndex: Int
    let isCurrentUser: Bool
}

enum LiveLobbySlotEventKind: Equatable {
    case created
    case updated
    case ended
}

struct LiveLobbySlotEventPayload {
    let eventID: String?
    let occurredAt: Date?
    let slotID: String?
    let userID: String?
    let status: String?
    let slot: OneToOneLiveSlot?

    init(data: [String: Any]) {
        eventID = Self.firstString([data], keys: ["event_id"])
        occurredAt = Self.date(
            Self.firstString([data], keys: ["occurred_at", "updated_at"])
        )
        let nestedSlot = data["slot"] as? [String: Any]
        var source = nestedSlot ?? data
        if source["id"] == nil, let slotID = Self.string(data["slot_id"]) {
            source["id"] = slotID
        }

        slot = Self.decodeSlot(source)
        slotID = Self.firstString(
            [source, data],
            keys: ["id", "slot_id"]
        ) ?? slot?.id
        status = Self.firstString(
            [source, data],
            keys: ["status", "slot_status"]
        )?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            ?? slot?.status.lowercased()

        let nestedUser = (source["user"] as? [String: Any])
            ?? (source["host"] as? [String: Any])
            ?? (data["user"] as? [String: Any])
            ?? (data["host"] as? [String: Any])
        userID = Self.nonBlank(slot?.user.userID)
            ?? Self.firstString(
                [nestedUser ?? [:], source, data],
                keys: ["user_id", "host_user_id", "host_id"]
            )
    }

    private static func decodeSlot(_ dictionary: [String: Any]) -> OneToOneLiveSlot? {
        guard JSONSerialization.isValidJSONObject(dictionary),
              let encoded = try? JSONSerialization.data(withJSONObject: dictionary)
        else { return nil }
        return try? JSONDecoder().decode(OneToOneLiveSlot.self, from: encoded)
    }

    private static func firstString(
        _ dictionaries: [[String: Any]],
        keys: [String]
    ) -> String? {
        for dictionary in dictionaries {
            for key in keys {
                if let value = string(dictionary[key]) {
                    return value
                }
            }
        }
        return nil
    }

    private static func string(_ value: Any?) -> String? {
        let result: String?
        if let value = value as? String {
            result = value
        } else if let value = value as? NSNumber {
            result = value.stringValue
        } else {
            result = nil
        }
        return nonBlank(result)
    }

    private static func nonBlank(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }
        return ISO8601DateFormatter().date(from: value)
    }
}

struct LiveLobbyEventCursor {
    private var latestOccurredAtBySlot: [String: Date] = [:]
    private var processedEventIDs = Set<String>()
    private var processedEventOrder: [String] = []

    mutating func shouldApply(
        eventID: String?,
        slotID: String?,
        occurredAt: Date?
    ) -> Bool {
        if let eventID, processedEventIDs.contains(eventID) {
            return false
        }

        if let slotID, let occurredAt {
            if let latest = latestOccurredAtBySlot[slotID], occurredAt < latest {
                remember(eventID)
                return false
            }
            latestOccurredAtBySlot[slotID] = occurredAt
        }
        remember(eventID)
        return true
    }

    private mutating func remember(_ eventID: String?) {
        guard let eventID, !eventID.isEmpty else { return }
        processedEventIDs.insert(eventID)
        processedEventOrder.append(eventID)
        if processedEventOrder.count > 256 {
            let removed = processedEventOrder.removeFirst()
            processedEventIDs.remove(removed)
        }
    }
}

enum LiveLobbySnapshotMergePolicy {
    static func merge(
        snapshot: [OneToOneLiveSlot],
        current: [OneToOneLiveSlot],
        slotMutationSequence: [String: Int],
        requestStartingMutation: Int
    ) -> [OneToOneLiveSlot] {
        let newerSlotIDs = Set(
            slotMutationSequence.compactMap { slotID, sequence in
                sequence > requestStartingMutation ? slotID : nil
            }
        )
        var merged = snapshot.filter {
            LiveLobbySlotPolicy.isVisible($0)
                && !newerSlotIDs.contains($0.id)
        }
        for slot in current where newerSlotIDs.contains(slot.id) {
            merged.removeAll { $0.id == slot.id || $0.user.userID == slot.user.userID }
            merged.append(slot)
        }

        var seenIDs = Set<String>()
        var seenUsers = Set<String>()
        let deduplicated = merged.filter {
            seenIDs.insert($0.id).inserted
                && seenUsers.insert($0.user.userID).inserted
        }
        return LiveLobbySlotPolicy.sorted(deduplicated)
    }
}

struct LiveCallPeer: Equatable {
    let userID: String
    let username: String
    let avatarURL: String
    let characterSetting: String
}

/// Converts compatible flat or nested backend invitation payloads into the
/// canonical keys consumed by `LiveCallCoordinator`.
enum LiveCallIncomingInvitationPayload {
    static func normalize(_ data: [String: Any]) -> [String: Any]? {
        var normalized: [String: Any] = [:]

        for key in ["data", "payload", "invitation", "call"] {
            if let nested = dictionary(data[key]) {
                merge(nested, into: &normalized)
            }
        }
        merge(data, into: &normalized)

        let invitation = dictionary(data["invitation"])
            ?? dictionary(normalized["invitation"])
        let call = dictionary(data["call"])
            ?? dictionary(normalized["call"])
        let caller = dictionary(data["caller"])
            ?? dictionary(data["inviter"])
            ?? dictionary(data["from_user"])
            ?? dictionary(normalized["caller"])
            ?? invitation.flatMap { dictionary($0["caller"]) }

        let callID = string(
            normalized,
            keys: ["call_id", "callId", "live_call_id"]
        ) ?? call.flatMap { string($0, keys: ["call_id", "callId", "id"]) }
            ?? invitation.flatMap { string($0, keys: ["call_id", "callId", "id"]) }

        let callerID = string(
            normalized,
            keys: ["caller_id", "caller_user_id", "from_user_id", "user_id", "callerId"]
        ) ?? caller.flatMap { string($0, keys: ["user_id", "userId", "id"]) }

        guard let callID, let callerID else { return nil }
        normalized["call_id"] = callID
        normalized["caller_id"] = callerID

        copyCanonicalString(
            into: &normalized,
            canonicalKey: "slot_id",
            sources: [normalized, invitation ?? [:], call ?? [:]],
            keys: ["slot_id", "live_slot_id", "slotId"]
        )
        copyCanonicalString(
            into: &normalized,
            canonicalKey: "caller_username",
            sources: [normalized, caller ?? [:]],
            keys: ["caller_username", "caller_name", "username", "nickname", "display_name"]
        )
        copyCanonicalString(
            into: &normalized,
            canonicalKey: "caller_avatar_url",
            sources: [normalized, caller ?? [:]],
            keys: ["caller_avatar_url", "caller_avatar", "avatar_url", "avatar"]
        )
        copyCanonicalString(
            into: &normalized,
            canonicalKey: "character_setting",
            sources: [normalized, caller ?? [:]],
            keys: ["caller_character_setting", "character_setting", "role_setting"]
        )
        copyCanonicalString(
            into: &normalized,
            canonicalKey: "call_type",
            sources: [normalized, invitation ?? [:], call ?? [:]],
            keys: ["call_type", "media_type", "callType"]
        )

        if normalized["billing_policy"] == nil,
           let policy = call?["billing_policy"] ?? call?["billingPolicy"] {
            normalized["billing_policy"] = policy
        }
        return normalized
    }

    private static func merge(_ source: [String: Any], into target: inout [String: Any]) {
        for (key, value) in source { target[key] = value }
    }

    private static func copyCanonicalString(
        into target: inout [String: Any],
        canonicalKey: String,
        sources: [[String: Any]],
        keys: [String]
    ) {
        guard string(target, keys: [canonicalKey]) == nil else { return }
        for source in sources {
            if let value = string(source, keys: keys) {
                target[canonicalKey] = value
                return
            }
        }
    }

    private static func dictionary(_ value: Any?) -> [String: Any]? {
        if let dictionary = value as? [String: Any] { return dictionary }
        if let string = value as? String,
           let encoded = string.data(using: .utf8),
           let dictionary = try? JSONSerialization.jsonObject(with: encoded) as? [String: Any] {
            return dictionary
        }
        return nil
    }

    private static func string(_ data: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = data[key] as? String {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
            if let value = data[key] as? NSNumber { return value.stringValue }
        }
        return nil
    }
}

enum LiveCallInvitationMetadata {
    static func requestedRoleSetting(from data: [String: Any]) -> String? {
        if let role = string(data, keys: ["requested_role_setting", "requested_character_setting"]) {
            return role
        }

        let source = string(data, keys: ["invitation_source", "source"])?
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
        let isAgentMatch = source == "agent_match"
            || source == "agent"
            || string(data, keys: ["match_id"]) != nil
        guard isAgentMatch else { return nil }
        return string(data, keys: ["role_setting", "character_setting"])
    }

    private static func string(_ data: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = data[key] as? String {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
            if let value = data[key] as? NSNumber {
                return value.stringValue
            }
        }
        return nil
    }
}

@MainActor
enum LiveAcceptedCallLauncher {
    static func open(
        peer: LiveCallPeer,
        response: CallJoinResponse,
        isOutgoing: Bool,
        liveRoleContext: LiveCallRoleContext?,
        fallbackCallType: CallType,
        fallbackBillingPolicy: LiveBillingPolicy,
        fallbackLiveExperience: LiveExperienceSnapshot? = nil
    ) {
        let contact = Contact(
            userID: peer.userID,
            nickname: peer.username,
            avatarURL: peer.avatarURL,
            lastMessage: nil,
            lastMessageTime: nil,
            unreadCount: 0
        )
        NotificationCenter.default.post(name: .resetLiveLobbyNavigation, object: nil)
        NotificationCenter.default.post(name: .openLivePairChat, object: contact)

        // Install the two-person chat underneath first, then reuse the
        // existing full-screen call surface above it. Its current minimize
        // control reveals the chat; video continues in PiP while voice uses
        // the existing compact audio bubble.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            CallManager.shared.connectAcceptedLiveCall(
                remoteUserID: peer.userID,
                remoteNickname: peer.username,
                remoteAvatarURL: peer.avatarURL,
                isOutgoing: isOutgoing,
                response: response,
                callType: response.callType ?? fallbackCallType,
                billingPolicy: response.billingPolicy ?? fallbackBillingPolicy,
                liveRoleContext: liveRoleContext,
                liveExperience: response.liveExperience ?? fallbackLiveExperience
            )
        }
    }
}

private enum LiveCallInvitationDirection: Equatable {
    case incoming
    case outgoing
}

private struct LiveCallPendingInvitation: Identifiable {
    let id = UUID()
    var callID: String?
    let slotID: String
    let peer: LiveCallPeer
    let requestedRoleSetting: String?
    let liveRoleContext: LiveCallRoleContext?
    var callType: CallType
    var billingPolicy: LiveBillingPolicy
    var paymentMethod: LiveCallPaymentMethod
    var liveExperience: LiveExperienceSnapshot?
    let direction: LiveCallInvitationDirection
}

enum LiveCallEventCorrelationResult: Equatable {
    case ignore
    case deferUntilCallID(String)
    case handle(String)
}

enum LiveCallEventCorrelation {
    /// A host can accept or reject immediately after receiving the WebSocket
    /// invite, before the caller's invite HTTP response has delivered its
    /// `call_id`. Preserve that early event and reconcile it when the response
    /// arrives instead of dropping it and leaving the caller's banner counting
    /// down.
    static func result(
        for data: [String: Any],
        isOutgoingInvitation: Bool,
        invitationCallID: String?,
        invitationSlotID: String,
        peerUserID: String
    ) -> LiveCallEventCorrelationResult {
        guard isOutgoingInvitation,
              string(data, keys: ["match_id"]) == nil,
              let eventCallID = string(data, keys: ["call_id"]) else {
            return .ignore
        }

        if let eventSlotID = string(data, keys: ["slot_id"]),
           !invitationSlotID.isEmpty,
           eventSlotID != invitationSlotID {
            return .ignore
        }

        if let eventPeerID = string(data, keys: ["host_id", "host_user_id"]),
           !peerUserID.isEmpty,
           eventPeerID != peerUserID {
            return .ignore
        }

        guard let invitationCallID = normalized(invitationCallID) else {
            return .deferUntilCallID(eventCallID)
        }
        return invitationCallID == eventCallID ? .handle(eventCallID) : .ignore
    }

    private static func string(_ data: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = normalized(data[key] as? String) { return value }
            if let value = data[key] as? NSNumber { return value.stringValue }
        }
        return nil
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

@MainActor
final class LiveCallCoordinator: ObservableObject {
    static let shared = LiveCallCoordinator()

    @Published private var invitation: LiveCallPendingInvitation?
    @Published private(set) var remainingSeconds = 15
    @Published private(set) var isWorking = false
    @Published var errorMessage: String?

    private var countdownTask: Task<Void, Never>?
    private var deferredAcceptedCallIDs = Set<String>()
    private var deferredClosedCallIDs = Set<String>()
    private var joiningCallID: String?
    private var stateReconciliationTask: Task<Void, Never>?
    private var supportsCallStateReconciliation = true
    private var cancellables = Set<AnyCancellable>()
    private var requestIdempotencyKeys: [String: UUID] = [:]

    private init() {
        WebSocketService.shared.liveCallInvitePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.receiveIncomingInvite($0) }
            .store(in: &cancellables)

        WebSocketService.shared.liveCallAcceptedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.handleAcceptedEvent($0) }
            .store(in: &cancellables)

        WebSocketService.shared.liveCallRejectedPublisher
            .merge(with: WebSocketService.shared.liveCallCancelledPublisher)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.handleClosedEvent($0) }
            .store(in: &cancellables)
    }

    var isIncoming: Bool {
        invitation?.direction == .incoming
    }

    var hasInvitation: Bool {
        guard let invitation else { return false }
        return invitation.direction == .incoming || invitation.callID != nil
    }

    var currentPeer: LiveCallPeer? {
        invitation?.peer
    }

    var currentRequestedRoleSetting: String? {
        guard invitation?.direction == .incoming else { return nil }
        return invitation?.requestedRoleSetting
    }

    var currentCallType: CallType {
        invitation?.callType ?? .video
    }

    var currentLiveExperience: LiveExperienceSnapshot? {
        invitation?.liveExperience
    }

    func requestCall(
        slotID: String,
        peer: LiveCallPeer,
        callType: CallType,
        billingPolicy: LiveBillingPolicy,
        paymentMethod: LiveCallPaymentMethod = .spendableBalance
    ) {
        guard LiveCallInitiationPolicy.canInitiate(
            isCurrentUserLive: LiveLobbyStore.shared.isCurrentUserLive
        ) else {
            errorMessage = LiveCallInitiationPolicy.liveLobbyHostingBlockMessage
            return
        }
        guard LiveLobbyStore.shared.supportedCallTypes.contains(callType) else {
            errorMessage = callType == .voice
                ? "当前服务暂未开放语音连线"
                : "当前服务暂未开放视频连线"
            return
        }
        guard invitation == nil, !isWorking, CallManager.shared.currentCall == nil else {
            errorMessage = "当前已有通话或连线邀请"
            return
        }

        isWorking = true
        let idempotencyScope = "\(slotID)|\(callType.rawValue)|\(paymentMethod.idempotencyScope)"
        let idempotencyKey = requestIdempotencyKeys[idempotencyScope] ?? UUID()
        requestIdempotencyKeys[idempotencyScope] = idempotencyKey
        Task {
            guard invitation == nil, CallManager.shared.currentCall == nil else {
                isWorking = false
                return
            }
            if paymentMethod.requiresStartingBalance {
                await WalletStore.shared.refreshBalanceFromServer(forceRefresh: true)
                guard let balance = WalletStore.shared.spendableBalance else {
                    isWorking = false
                    errorMessage = L10n.tr("activityCatFood.balanceUnavailable")
                    return
                }
                guard billingPolicy.canStart(balance: balance) else {
                    isWorking = false
                    errorMessage = L10n.tr(
                        callType == .voice
                            ? "activityCatFood.voiceInsufficient"
                            : "activityCatFood.videoCallInsufficient"
                    )
                    return
                }
            }

            let pending = LiveCallPendingInvitation(
                callID: nil,
                slotID: slotID,
                peer: peer,
                requestedRoleSetting: nil,
                liveRoleContext: LiveCallRoleContext(
                    source: .lobby,
                    roleSetting: peer.characterSetting
                ),
                callType: callType,
                billingPolicy: billingPolicy,
                paymentMethod: paymentMethod,
                liveExperience: paymentMethod.experienceCardKind.map {
                    LiveExperienceSnapshot(
                        definitionID: $0.definitionID,
                        durationSeconds: $0.durationSeconds,
                        status: .reserved
                    )
                },
                direction: .outgoing
            )
            invitation = pending

            do {
                let response = try await APIService.shared.requestOneToOneLiveCall(
                    slotID: slotID,
                    callType: callType,
                    paymentMethod: paymentMethod,
                    idempotencyKey: idempotencyKey
                )
                requestIdempotencyKeys.removeValue(forKey: idempotencyScope)
                guard invitation?.id == pending.id else {
                    try? await APIService.shared.cancelOneToOneLiveCall(callID: response.callID)
                    if paymentMethod.experienceCardKind != nil {
                        await PropInventoryStore.shared.load(forceRefresh: true)
                    }
                    return
                }
                let callID = response.callID.trimmingCharacters(in: .whitespacesAndNewlines)
                invitation?.callID = callID
                invitation?.callType = response.callType
                invitation?.billingPolicy = response.billingPolicy ?? billingPolicy
                invitation?.liveExperience = response.liveExperience ?? invitation?.liveExperience
                if let kind = paymentMethod.experienceCardKind {
                    if let reservation = response.liveExperience?.reservedProp {
                        PropInventoryStore.shared.applyLiveExperienceReservation(
                            reservation,
                            fallbackKind: kind
                        )
                    } else {
                        Task { await PropInventoryStore.shared.load(forceRefresh: true) }
                    }
                }
                isWorking = false
                remainingSeconds = 15
                startCountdown(for: pending.id)
                reconcileDeferredEvents(for: pending.id, callID: callID)
            } catch {
                guard invitation?.id == pending.id else { return }
                clearInvitation()
                errorMessage = userFacingMessage(
                    error,
                    fallback: "暂时无法发起\(callType == .voice ? "语音" : "视频")邀请"
                )
            }
        }
    }

    func acceptIncoming() {
        guard let pending = invitation,
              pending.direction == .incoming,
              let callID = pending.callID,
              !isWorking else { return }
        isWorking = true

        Task {
            do {
                let response = try await APIService.shared.acceptOneToOneLiveCall(callID: callID)
                guard invitation?.id == pending.id else { return }
                activateCall(pending: pending, response: response, isOutgoing: false)
            } catch {
                guard invitation?.id == pending.id else { return }
                isWorking = false
                errorMessage = userFacingMessage(
                    error,
                    fallback: "暂时无法接受\(pending.callType == .voice ? "语音" : "视频")邀请"
                )
            }
        }
    }

    func rejectIncoming() {
        guard let pending = invitation, pending.direction == .incoming else { return }
        clearInvitation(refreshProps: false)
        guard let callID = pending.callID else { return }
        Task { try? await APIService.shared.rejectOneToOneLiveCall(callID: callID, reason: "rejected") }
    }

    func cancelOutgoing() {
        guard let pending = invitation, pending.direction == .outgoing else { return }
        clearInvitation(refreshProps: false)
        guard let callID = pending.callID else { return }
        Task {
            try? await APIService.shared.cancelOneToOneLiveCall(callID: callID)
            if pending.paymentMethod.experienceCardKind != nil {
                await PropInventoryStore.shared.load(forceRefresh: true)
            }
        }
    }

    private func receiveIncomingInvite(_ data: [String: Any]) {
        guard let data = LiveCallIncomingInvitationPayload.normalize(data),
              let callID = Self.string(data, keys: ["call_id"]),
              let callerID = Self.string(data, keys: ["caller_id"])
        else {
            print("[LiveCall] Ignored incoming invitation with missing call/caller identity")
            return
        }

        let pending = LiveCallPendingInvitation(
            callID: callID,
            slotID: Self.string(data, keys: ["slot_id"]) ?? "",
            peer: LiveCallPeer(
                userID: callerID,
                username: Self.string(data, keys: ["caller_username", "username", "caller_name"]) ?? callerID,
                avatarURL: Self.string(data, keys: ["caller_avatar_url", "avatar_url"]) ?? "",
                characterSetting: Self.string(data, keys: ["character_setting", "role_setting"]) ?? ""
            ),
            requestedRoleSetting: LiveCallInvitationMetadata.requestedRoleSetting(from: data),
            liveRoleContext: Self.incomingRoleContext(from: data),
            callType: Self.callType(from: data) ?? .video,
            billingPolicy: Self.billingPolicy(from: data)
                ?? LiveLobbyStore.shared.billingPolicy,
            paymentMethod: Self.liveExperience(from: data)?.cardKind.map {
                .experienceCard($0)
            } ?? .spendableBalance,
            liveExperience: Self.liveExperience(from: data),
            direction: .incoming
        )

        guard invitation == nil, CallManager.shared.currentCall == nil else {
            Task { try? await APIService.shared.rejectOneToOneLiveCall(callID: callID, reason: "busy") }
            return
        }

        invitation = pending
        remainingSeconds = 15
        startCountdown(for: pending.id)
    }

    private func handleAcceptedEvent(_ data: [String: Any]) {
        guard let pending = invitation else { return }
        switch LiveCallEventCorrelation.result(
            for: data,
            isOutgoingInvitation: pending.direction == .outgoing,
            invitationCallID: pending.callID,
            invitationSlotID: pending.slotID,
            peerUserID: pending.peer.userID
        ) {
        case .ignore:
            return
        case .deferUntilCallID(let callID):
            deferredAcceptedCallIDs.insert(callID)
        case .handle(let callID):
            joinAcceptedCall(pending: pending, callID: callID)
        }
    }

    private func joinAcceptedCall(pending: LiveCallPendingInvitation, callID: String) {
        guard invitation?.id == pending.id, joiningCallID == nil else { return }
        joiningCallID = callID
        isWorking = true

        Task {
            do {
                let response = try await APIService.shared.joinAcceptedOneToOneLiveCall(callID: callID)
                guard invitation?.id == pending.id else { return }
                activateCall(pending: pending, response: response, isOutgoing: true)
            } catch {
                guard invitation?.id == pending.id else { return }
                clearInvitation()
                errorMessage = userFacingMessage(
                    error,
                    fallback: "\(pending.callType == .voice ? "语音" : "视频")连接失败"
                )
            }
        }
    }

    private func handleClosedEvent(_ data: [String: Any]) {
        guard let pending = invitation else { return }
        if pending.direction == .incoming {
            guard let currentCallID = pending.callID,
                  currentCallID == Self.string(data, keys: ["call_id"]) else { return }
            clearInvitation()
            return
        }
        switch LiveCallEventCorrelation.result(
            for: data,
            isOutgoingInvitation: true,
            invitationCallID: pending.callID,
            invitationSlotID: pending.slotID,
            peerUserID: pending.peer.userID
        ) {
        case .ignore:
            return
        case .deferUntilCallID(let callID):
            deferredClosedCallIDs.insert(callID)
        case .handle:
            clearInvitation()
        }
    }

    private func reconcileDeferredEvents(for invitationID: UUID, callID: String) {
        guard let pending = invitation, pending.id == invitationID else { return }

        // A later terminal event wins over an earlier accepted event. This
        // mirrors the ordering of the server lifecycle and avoids joining a
        // call that was already cancelled while the invite response was in
        // flight.
        if deferredClosedCallIDs.contains(callID) {
            clearInvitation()
            return
        }

        let wasAccepted = deferredAcceptedCallIDs.contains(callID)
        deferredAcceptedCallIDs.removeAll()
        deferredClosedCallIDs.removeAll()
        if wasAccepted {
            joinAcceptedCall(pending: pending, callID: callID)
        } else {
            startCallStateReconciliation(pending: pending, callID: callID)
        }
    }

    private func startCallStateReconciliation(
        pending: LiveCallPendingInvitation,
        callID: String
    ) {
        stateReconciliationTask?.cancel()
        guard supportsCallStateReconciliation else { return }

        stateReconciliationTask = Task { [weak self] in
            for _ in 0..<15 {
                guard !Task.isCancelled,
                      let self,
                      self.invitation?.id == pending.id,
                      self.invitation?.callID == callID,
                      self.joiningCallID == nil else { return }

                do {
                    let state = try await APIService.shared.getOneToOneLiveCallState(callID: callID)
                    guard state.callID == callID else { return }
                    self.invitation?.callType = state.callType
                    if let policy = state.billingPolicy {
                        self.invitation?.billingPolicy = policy
                    }
                    if let liveExperience = state.liveExperience {
                        self.invitation?.liveExperience = liveExperience
                    }
                    switch state.phase {
                    case .accepted:
                        self.joinAcceptedCall(
                            pending: self.invitation ?? pending,
                            callID: callID
                        )
                        return
                    case .terminal:
                        self.clearInvitation()
                        return
                    case .pending:
                        break
                    }
                } catch APIError.serverError(let code, _) where code == 404 || code == 405 {
                    // Backward compatibility while the status endpoint rolls
                    // out. Keep the existing WebSocket-only flow for the rest
                    // of this app session.
                    self.supportsCallStateReconciliation = false
                    return
                } catch APIError.decodingError(_) {
                    self.supportsCallStateReconciliation = false
                    return
                } catch APIError.unauthorized {
                    return
                } catch {
                    // A transient status lookup failure must not tear down a
                    // valid invitation; the WebSocket path remains active.
                }

                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func activateCall(
        pending: LiveCallPendingInvitation,
        response: CallJoinResponse,
        isOutgoing: Bool
    ) {
        clearInvitation()
        LiveAcceptedCallLauncher.open(
            peer: pending.peer,
            response: response,
            isOutgoing: isOutgoing,
            liveRoleContext: pending.liveRoleContext,
            fallbackCallType: pending.callType,
            fallbackBillingPolicy: pending.billingPolicy,
            fallbackLiveExperience: pending.liveExperience
        )
    }

    private func startCountdown(for invitationID: UUID) {
        countdownTask?.cancel()
        countdownTask = Task { [weak self] in
            for value in stride(from: 14, through: 0, by: -1) {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled,
                      let self,
                      self.invitation?.id == invitationID else { return }
                self.remainingSeconds = value
            }
            guard let self, self.invitation?.id == invitationID else { return }
            self.expireInvitation()
        }
    }

    private func expireInvitation() {
        guard let pending = invitation else { return }
        clearInvitation(refreshProps: false)
        guard let callID = pending.callID else { return }
        Task {
            if pending.direction == .incoming {
                try? await APIService.shared.rejectOneToOneLiveCall(callID: callID, reason: "timeout")
            } else {
                try? await APIService.shared.cancelOneToOneLiveCall(callID: callID)
                if pending.paymentMethod.experienceCardKind != nil {
                    await PropInventoryStore.shared.load(forceRefresh: true)
                }
            }
        }
    }

    private func clearInvitation(refreshProps: Bool = true) {
        let shouldRefreshProps = refreshProps
            && invitation?.paymentMethod.experienceCardKind != nil
        countdownTask?.cancel()
        countdownTask = nil
        stateReconciliationTask?.cancel()
        stateReconciliationTask = nil
        deferredAcceptedCallIDs.removeAll()
        deferredClosedCallIDs.removeAll()
        joiningCallID = nil
        invitation = nil
        remainingSeconds = 15
        isWorking = false
        if shouldRefreshProps {
            Task { await PropInventoryStore.shared.load(forceRefresh: true) }
        }
    }

    private func userFacingMessage(_ error: Error, fallback: String) -> String {
        if let localizedError = error as? LocalizedError,
           let description = localizedError.errorDescription,
           !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return description
        }
        return fallback
    }

    private static func string(_ data: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = data[key] as? String, !value.isEmpty { return value }
            if let value = data[key] as? NSNumber { return value.stringValue }
        }
        return nil
    }

    private static func callType(from data: [String: Any]) -> CallType? {
        guard let raw = string(data, keys: ["call_type", "media_type"])?
            .lowercased() else { return nil }
        switch raw {
        case "voice", "audio": return .voice
        case "video", "audio_video", "audiovideo": return .video
        default: return nil
        }
    }

    private static func billingPolicy(from data: [String: Any]) -> LiveBillingPolicy? {
        guard let object = data["billing_policy"] as? [String: Any],
              JSONSerialization.isValidJSONObject(object),
              let encoded = try? JSONSerialization.data(withJSONObject: object)
        else { return nil }
        return try? JSONDecoder().decode(LiveBillingPolicy.self, from: encoded)
    }

    private static func liveExperience(from data: [String: Any]) -> LiveExperienceSnapshot? {
        guard let object = data["live_experience"] as? [String: Any]
                ?? data["experience"] as? [String: Any],
              JSONSerialization.isValidJSONObject(object),
              let encoded = try? JSONSerialization.data(withJSONObject: object)
        else { return nil }
        return (try? JSONDecoder().decode(LiveExperienceSnapshot.self, from: encoded))?
            .anchored(serverTime: string(data, keys: ["server_time"]))
    }

    private static func incomingRoleContext(from data: [String: Any]) -> LiveCallRoleContext? {
        if let requestedRole = LiveCallInvitationMetadata.requestedRoleSetting(from: data) {
            return LiveCallRoleContext(source: .agentMatch, roleSetting: requestedRole)
        }
        return LiveCallRoleContext(
            source: .lobby,
            roleSetting: LiveLobbyStore.shared.currentRoleSetting
                ?? Self.string(
                    data,
                    keys: ["host_character_setting", "character_setting", "role_setting"]
                )
        )
    }
}

struct LiveCallInvitationBanner: View {
    @ObservedObject private var coordinator = LiveCallCoordinator.shared

    var body: some View {
        if let peer = coordinator.currentPeer {
            HStack(spacing: 11) {
                AvatarView(url: peer.avatarURL, size: 42)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(coordinator.isIncoming ? peer.username : "等待 \(peer.username) 接受")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    Text(
                        coordinator.isIncoming
                            ? "邀请你进行一对一\(coordinator.currentCallType == .voice ? "语音" : "视频")"
                            : "\(coordinator.currentCallType == .voice ? "语音" : "视频")邀请已发送"
                    )
                        .font(.system(size: 12))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)

                    if let minutes = coordinator.currentLiveExperience?.cardKind?.minutes {
                        Text(L10n.tr(
                            coordinator.isIncoming
                                ? "live.experience.invitation.host"
                                : "live.experience.invitation.viewer",
                            minutes
                        ))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(coordinator.isIncoming ? AppColors.warningColor : AppColors.accent)
                        .lineLimit(2)
                    }

                    if let requestedRole = coordinator.currentRequestedRoleSetting {
                        Text("希望你扮演：\(requestedRole)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(AppColors.accent)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel("本次希望你扮演 \(requestedRole)")
                    }
                }

                Spacer(minLength: 4)

                Text("\(coordinator.remainingSeconds)s")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundColor(AppColors.secondaryText)
                    .frame(minWidth: 26)

                if coordinator.isIncoming {
                    Button(action: coordinator.rejectIncoming) {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(AppColors.secondaryText)
                            .frame(width: 34, height: 34)
                            .background(AppColors.secondaryBackground)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(coordinator.isWorking)
                    .accessibilityLabel("拒绝\(coordinator.currentCallType == .voice ? "语音" : "视频")")

                    Button(action: coordinator.acceptIncoming) {
                        Group {
                            if coordinator.isWorking {
                                ProgressView().tint(.white)
                            } else {
                                Image(
                                    systemName: coordinator.currentCallType == .voice
                                        ? "phone.fill"
                                        : "video.fill"
                                )
                                    .font(.system(size: 13, weight: .semibold))
                            }
                        }
                        .foregroundColor(.white)
                        .frame(width: 38, height: 34)
                        .background(Color(hex: "34C759"))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(coordinator.isWorking)
                    .accessibilityLabel("接受\(coordinator.currentCallType == .voice ? "语音" : "视频")")
                } else {
                    Button(action: coordinator.cancelOutgoing) {
                        Text("取消")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .frame(minWidth: 38, minHeight: 34)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.leading, 10)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)
            .background(AppColors.cardBackground.opacity(0.82))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.7), lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.14), radius: 16, x: 0, y: 7)
            .padding(.horizontal, 12)
            .padding(.top, 52)
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityElement(children: .contain)
        }
    }
}

@MainActor
final class LiveLobbyStore: ObservableObject {
    static let shared = LiveLobbyStore()

    @Published fileprivate var participants: [LiveLobbyParticipant]
    @Published private(set) var isUpdating = false
    @Published fileprivate private(set) var hasLoaded = false
    @Published fileprivate private(set) var billingPolicy = LiveBillingPolicy.fallback
    @Published fileprivate private(set) var supportedCallTypes: [CallType] = [.video]
    @Published fileprivate private(set) var liveAvatarUploadSupported = false
    @Published var errorMessage: String?

    private var activeUserID: String?
    @Published private var currentSlot: OneToOneLiveSlot?
    private var currentSlotStatus: String?
    private var lobbySlots: [OneToOneLiveSlot] = []
    private var activeTab: LiveLobbyTab = .recommended
    private var heartbeatTask: Task<Void, Never>?
    private var refreshGeneration = 0
    private var mutationSequence = 0
    private var ownSlotMutationSequence = 0
    private var slotMutationSequence: [String: Int] = [:]
    private var eventCursor = LiveLobbyEventCursor()
    private var supportsCurrentSlotEndpoint = true
    private var cancellables = Set<AnyCancellable>()

    private init() {
        participants = []
        NotificationCenter.default.publisher(for: .liveHostCallDidEnd)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.handleHostCallEnded()
            }
            .store(in: &cancellables)

        WebSocketService.shared.$isConnected
            .removeDuplicates()
            .dropFirst()
            .filter { $0 }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self,
                      let user = AuthManager.shared.currentUser,
                      user.userID == self.activeUserID else { return }
                Task {
                    await self.refresh(tab: self.activeTab, user: user)
                }
            }
            .store(in: &cancellables)
    }

    var isCurrentUserLive: Bool {
        currentSlot != nil && currentSlotStatus != "ended"
    }

    var currentRoleSetting: String? {
        currentSlot?.characterSetting
    }

    func synchronizeCurrentUserLiveStatus(user: User?) async {
        guard let user, !user.userID.isEmpty else {
            resetForAccount(nil)
            return
        }
        activateAccount(user.userID)
        await refresh(tab: activeTab, user: user)
    }

    fileprivate func refresh(tab: LiveLobbyTab, user: User?) async {
        guard let user, !user.userID.isEmpty else {
            resetForAccount(nil)
            return
        }
        activateAccount(user.userID)
        activeTab = tab
        refreshGeneration += 1
        let generation = refreshGeneration
        let mutationAtStart = mutationSequence
        let ownMutationAtStart = ownSlotMutationSequence
        let shouldFetchCurrent = supportsCurrentSlotEndpoint

        async let pageResult = fetchLobbyPage(tab: tab)
        async let currentResult = fetchCurrentSlot(enabled: shouldFetchCurrent)
        let (page, owned) = await (pageResult, currentResult)

        guard !Task.isCancelled,
              generation == refreshGeneration,
              activeUserID == user.userID else { return }

        switch page {
        case .success(let value):
            billingPolicy = value.billingPolicy
            supportedCallTypes = value.supportedCallTypes
            liveAvatarUploadSupported = value.liveAvatarUploadSupported
            mergeLobbySnapshot(
                value.items,
                newerThan: mutationAtStart
            )
        case .failure(let error):
            if !(error is CancellationError) {
                errorMessage = userFacingMessage(
                    error,
                    fallback: "直播列表加载失败，请稍后重试"
                )
            }
        }
        hasLoaded = true

        if ownSlotMutationSequence == ownMutationAtStart {
            applyCurrentSlotResult(owned, fallbackSlots: lobbySlots, userID: user.userID)
        }
        mergeCurrentActiveSlotIntoLobby()
        rebuildParticipants(tab: tab, currentUserID: user.userID)
    }

    @discardableResult
    fileprivate func startLive(
        roleSetting: String,
        liveAvatarData: Data?,
        allowedCallTypes: [CallType],
        avatarUploadIdempotencyKey: UUID,
        slotCreationIdempotencyKey: UUID,
        user: User?
    ) async -> LiveLobbyParticipant? {
        let trimmedRole = roleSetting.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let user, !user.userID.isEmpty, !trimmedRole.isEmpty, !isUpdating else {
            return nil
        }
        activateAccount(user.userID)
        isUpdating = true
        defer { isUpdating = false }

        do {
            let liveAvatarAssetID: String?
            if let liveAvatarData {
                liveAvatarAssetID = try await APIService.shared.uploadOneToOneLiveAvatar(
                    imageData: liveAvatarData,
                    idempotencyKey: avatarUploadIdempotencyKey
                ).assetID
            } else {
                liveAvatarAssetID = nil
            }
            let slot = try await APIService.shared.createOneToOneLiveSlot(
                characterSetting: trimmedRole,
                liveAvatarAssetID: liveAvatarAssetID,
                allowedCallTypes: allowedCallTypes,
                idempotencyKey: slotCreationIdempotencyKey
            )
            guard activeUserID == user.userID else { return nil }
            setCurrentSlot(slot, status: slot.status, recordsMutation: true)
            upsertLobbySlot(slot, recordsMutation: true)
            let participant = participant(from: slot, currentUserID: user.userID, hasChatted: false)
            rebuildParticipants(tab: activeTab, currentUserID: user.userID)
            return participant
        } catch {
            guard activeUserID == user.userID else { return nil }
            if let recovered = await recoverCurrentUserSlot(userID: user.userID) {
                errorMessage = nil
                return recovered
            }
            errorMessage = userFacingMessage(error, fallback: "挂上直播失败，请稍后重试")
            return nil
        }
    }

    fileprivate func stopCurrentUserLive(user: User?) async -> Bool {
        guard let user,
              activeUserID == user.userID,
              let slotID = currentSlot?.id,
              !slotID.isEmpty,
              !isUpdating
        else {
            return false
        }
        isUpdating = true
        defer { isUpdating = false }

        do {
            try await APIService.shared.deleteOneToOneLiveSlot(
                slotID: slotID,
                idempotencyKey: UUID()
            )
            guard activeUserID == user.userID else { return false }
            heartbeatTask?.cancel()
            heartbeatTask = nil
            setCurrentSlot(nil, status: "ended", recordsMutation: true)
            removeLobbySlot(slotID: slotID, userID: user.userID, recordsMutation: true)
            rebuildParticipants(tab: activeTab, currentUserID: user.userID)
            return true
        } catch {
            guard activeUserID == user.userID else { return false }
            errorMessage = userFacingMessage(error, fallback: "退出直播失败，请稍后重试")
            return false
        }
    }

    fileprivate func applySlotEvent(
        _ kind: LiveLobbySlotEventKind,
        data: [String: Any],
        tab: LiveLobbyTab,
        user: User?
    ) {
        guard let user,
              !user.userID.isEmpty,
              activeUserID == user.userID
        else { return }

        let payload = LiveLobbySlotEventPayload(data: data)
        guard shouldApplyEvent(payload) else { return }
        let shouldRemove = kind == .ended
            || payload.status.map {
                LiveLobbyAvailability(status: $0) == .ended
            } == true

        if shouldRemove {
            guard payload.slotID != nil || payload.userID != nil else {
                requestRefresh(tab: tab, user: user)
                return
            }
            recordMutation(slotID: payload.slotID)
            removeLobbySlot(
                slotID: payload.slotID,
                userID: payload.userID,
                recordsMutation: false
            )
            let endsOwnSlot = (payload.slotID.map { $0 == currentSlot?.id } ?? false)
                || payload.userID == user.userID
            if endsOwnSlot {
                if kind == .ended
                    || payload.status.map({
                        LiveLobbyAvailability(status: $0) == .ended
                    }) == true {
                    setCurrentSlot(nil, status: "ended", recordsMutation: true)
                } else {
                    let status = payload.status ?? payload.slot?.status ?? currentSlotStatus
                    setCurrentSlot(
                        payload.slot ?? currentSlot,
                        status: status,
                        recordsMutation: true
                    )
                }
            }
            rebuildParticipants(tab: tab, currentUserID: user.userID)
            return
        }

        guard let slot = payload.slot,
              !slot.id.isEmpty,
              !slot.user.userID.isEmpty,
              LiveLobbySlotPolicy.isVisible(slot)
        else {
            requestRefresh(tab: tab, user: user)
            return
        }

        upsertLobbySlot(slot, recordsMutation: true)
        if slot.user.userID == user.userID {
            setCurrentSlot(slot, status: slot.status, recordsMutation: true)
        }
        rebuildParticipants(tab: tab, currentUserID: user.userID)
    }

    private func requestRefresh(tab: LiveLobbyTab, user: User) {
        Task { [weak self] in
            await self?.refresh(tab: tab, user: user)
        }
    }

    private enum CurrentSlotFetchResult {
        case value(OneToOneLiveSlot?)
        case unsupported
        case failure(Error)
    }

    private func fetchLobbyPage(
        tab: LiveLobbyTab
    ) async -> Result<OneToOneLiveSlotPage, Error> {
        do {
            return .success(
                try await APIService.shared.getOneToOneLiveSlots(filter: tab.rawValue)
            )
        } catch {
            return .failure(error)
        }
    }

    private func fetchCurrentSlot(enabled: Bool) async -> CurrentSlotFetchResult {
        guard enabled else { return .unsupported }
        do {
            return .value(try await APIService.shared.getCurrentOneToOneLiveSlot())
        } catch APIError.serverError(let code, _) where code == 404 || code == 405 {
            return .unsupported
        } catch {
            return .failure(error)
        }
    }

    private func applyCurrentSlotResult(
        _ result: CurrentSlotFetchResult,
        fallbackSlots: [OneToOneLiveSlot],
        userID: String
    ) {
        switch result {
        case .value(let slot):
            if let slot, LiveLobbySlotPolicy.isVisible(slot) {
                setCurrentSlot(slot, status: slot.status, recordsMutation: false)
            } else {
                setCurrentSlot(nil, status: "ended", recordsMutation: false)
            }
        case .unsupported:
            supportsCurrentSlotEndpoint = false
            if let ownActive = fallbackSlots.first(where: {
                $0.user.userID == userID && LiveLobbySlotPolicy.isVisible($0)
            }) {
                setCurrentSlot(ownActive, status: ownActive.status, recordsMutation: false)
            }
        case .failure:
            // A transient current-slot lookup must preserve the last explicit
            // lifecycle state. If this is a cold load, the waiting list is a
            // safe compatibility fallback until the endpoint recovers.
            if currentSlot == nil,
               let ownActive = fallbackSlots.first(where: {
                   $0.user.userID == userID && LiveLobbySlotPolicy.isVisible($0)
               }) {
                setCurrentSlot(ownActive, status: ownActive.status, recordsMutation: false)
            }
        }
    }

    private func mergeLobbySnapshot(
        _ slots: [OneToOneLiveSlot],
        newerThan startingMutation: Int
    ) {
        lobbySlots = LiveLobbySnapshotMergePolicy.merge(
            snapshot: slots,
            current: lobbySlots,
            slotMutationSequence: slotMutationSequence,
            requestStartingMutation: startingMutation
        )
    }

    private func mergeCurrentActiveSlotIntoLobby() {
        guard let currentSlot,
              LiveLobbySlotPolicy.isVisible(currentSlot) else { return }
        upsertLobbySlot(currentSlot, recordsMutation: false)
    }

    private func rebuildParticipants(tab: LiveLobbyTab, currentUserID: String) {
        activeTab = tab
        let mapped = LiveLobbySlotPolicy.sorted(lobbySlots).map {
            participant(
                from: $0,
                currentUserID: currentUserID,
                hasChatted: tab == .chatted
            )
        }
        withAnimation(.spring(response: 0.36, dampingFraction: 0.88)) {
            participants = mapped
        }
    }

    private func upsertLobbySlot(_ slot: OneToOneLiveSlot, recordsMutation: Bool) {
        guard LiveLobbySlotPolicy.isVisible(slot) else { return }
        if let existingIndex = lobbySlots.firstIndex(where: {
            $0.id == slot.id || $0.user.userID == slot.user.userID
        }) {
            lobbySlots.removeAll {
                $0.id == slot.id || $0.user.userID == slot.user.userID
            }
            lobbySlots.insert(slot, at: min(existingIndex, lobbySlots.count))
        } else {
            lobbySlots.insert(slot, at: 0)
        }
        lobbySlots = LiveLobbySlotPolicy.sorted(lobbySlots)
        if recordsMutation {
            recordMutation(slotID: slot.id)
        }
    }

    private func removeLobbySlot(
        slotID: String?,
        userID: String?,
        recordsMutation: Bool
    ) {
        lobbySlots.removeAll { slot in
            (slotID.map { slot.id == $0 } ?? false)
                || (userID.map { slot.user.userID == $0 } ?? false)
        }
        if recordsMutation {
            recordMutation(slotID: slotID)
        }
    }

    private func setCurrentSlot(
        _ slot: OneToOneLiveSlot?,
        status: String?,
        recordsMutation: Bool
    ) {
        currentSlot = slot
        currentSlotStatus = status?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if recordsMutation {
            mutationSequence += 1
            ownSlotMutationSequence = mutationSequence
            if let slotID = slot?.id {
                slotMutationSequence[slotID] = mutationSequence
            }
        }
        if let currentSlotStatus,
           LiveLobbyAvailability(status: currentSlotStatus).isVisibleInLobby,
           currentSlot != nil {
            startHeartbeatIfNeeded()
        } else {
            heartbeatTask?.cancel()
            heartbeatTask = nil
        }
    }

    private func recordMutation(slotID: String?) {
        mutationSequence += 1
        if let slotID, !slotID.isEmpty {
            slotMutationSequence[slotID] = mutationSequence
        }
    }

    private func shouldApplyEvent(_ payload: LiveLobbySlotEventPayload) -> Bool {
        eventCursor.shouldApply(
            eventID: payload.eventID,
            slotID: payload.slotID ?? payload.slot?.id,
            occurredAt: payload.occurredAt
        )
    }

    private func activateAccount(_ userID: String) {
        guard activeUserID != userID else { return }
        resetForAccount(userID)
    }

    private func resetForAccount(_ userID: String?) {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        activeUserID = userID
        currentSlot = nil
        currentSlotStatus = nil
        lobbySlots = []
        participants = []
        hasLoaded = false
        billingPolicy = .fallback
        supportedCallTypes = [.video]
        liveAvatarUploadSupported = false
        errorMessage = nil
        refreshGeneration += 1
        mutationSequence = 0
        ownSlotMutationSequence = 0
        slotMutationSequence = [:]
        eventCursor = LiveLobbyEventCursor()
        supportsCurrentSlotEndpoint = true
    }

    private func handleHostCallEnded() {
        guard !isUpdating,
              let user = AuthManager.shared.currentUser,
              user.userID == activeUserID else { return }
        requestRefresh(tab: activeTab, user: user)
    }

    private func startHeartbeatIfNeeded() {
        guard heartbeatTask == nil,
              currentSlot != nil,
              let currentSlotStatus,
              LiveLobbyAvailability(status: currentSlotStatus).isVisibleInLobby else { return }
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                guard !Task.isCancelled,
                      let self,
                      let slotID = self.currentSlot?.id,
                      !slotID.isEmpty
                else { return }
                try? await APIService.shared.heartbeatOneToOneLiveSlot(slotID: slotID)
            }
        }
    }

    private func recoverCurrentUserSlot(userID: String) async -> LiveLobbyParticipant? {
        if let currentSlot, currentSlot.user.userID == userID {
            return participant(from: currentSlot, currentUserID: userID, hasChatted: false)
        }

        let recoveredCurrent = try? await APIService.shared.getCurrentOneToOneLiveSlot()
        let fallbackPage = try? await APIService.shared.getOneToOneLiveSlots(
            filter: LiveLobbyTab.recommended.rawValue
        )
        guard activeUserID == userID,
              let slot = recoveredCurrent ?? fallbackPage?.items.first(where: {
                  $0.user.userID == userID && LiveLobbySlotPolicy.isVisible($0)
              }),
              LiveLobbySlotPolicy.isVisible(slot) else { return nil }

        setCurrentSlot(slot, status: slot.status, recordsMutation: false)
        let recovered = participant(from: slot, currentUserID: userID, hasChatted: false)
        upsertLobbySlot(slot, recordsMutation: false)
        rebuildParticipants(tab: activeTab, currentUserID: userID)
        return recovered
    }

    private func participant(
        from slot: OneToOneLiveSlot,
        currentUserID: String,
        hasChatted: Bool
    ) -> LiveLobbyParticipant {
        let name = [slot.user.nickname, slot.user.username]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty }) ?? slot.user.userID
        let paletteIndex = slot.user.userID.unicodeScalars.reduce(0) {
            $0 &+ Int($1.value)
        }
        return LiveLobbyParticipant(
            id: slot.id,
            userID: slot.user.userID,
            displayName: name,
            avatarURL: slot.liveAvatarURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? slot.user.avatarURL
                : slot.liveAvatarURL,
            roleSetting: slot.characterSetting,
            allowedCallTypes: slot.allowedCallTypes,
            gender: LiveLobbyGender(rawValue: slot.user.gender),
            availability: LiveLobbyAvailability(status: slot.status),
            hasChatted: hasChatted,
            paletteIndex: paletteIndex,
            isCurrentUser: slot.user.userID == currentUserID
        )
    }

    private func userFacingMessage(_ error: Error, fallback: String) -> String {
        if let localizedError = error as? LocalizedError,
           let description = localizedError.errorDescription,
           !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return description
        }
        return fallback
    }
}

struct LiveLobbyView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var authManager = AuthManager.shared
    @StateObject private var store = LiveLobbyStore.shared
    @State private var selectedTab: LiveLobbyTab = .recommended
    @State private var presentedDialog: LiveLobbyDialog?
    @State private var newlyStartedParticipantID: String?

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: 12, alignment: .top),
        count: 2
    )

    private var visibleParticipants: [LiveLobbyParticipant] {
        switch selectedTab {
        case .recommended:
            return store.participants
        case .chatted:
            return store.participants.filter(\.hasChatted)
        }
    }

    private var isCurrentUserLive: Bool {
        store.isCurrentUserLive
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 16) {
                LiveLobbyPricingBanner(
                    policy: store.billingPolicy,
                    supportedCallTypes: store.supportedCallTypes
                )

                if !store.hasLoaded {
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(0..<4, id: \.self) { _ in
                            LiveLobbySkeletonCard()
                        }
                    }
                    .accessibilityHidden(true)
                } else if visibleParticipants.isEmpty {
                    LiveLobbyEmptyState(tab: selectedTab)
                } else {
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(visibleParticipants) { participant in
                            LiveLobbyAvatarCell(
                                participant: participant,
                                isNewlyStarted: newlyStartedParticipantID == participant.id,
                                onOpen: {
                                    presentParticipantDialog(
                                        participant,
                                        preferredCallType: nil
                                    )
                                }
                            )
                            .transition(.scale(scale: 0.84).combined(with: .opacity))
                        }
                    }
                    .animation(
                        .spring(response: 0.42, dampingFraction: 0.84),
                        value: visibleParticipants
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 32)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(AppColors.cardBackground, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .hidesTabBarOnPush()
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton(tint: AppColors.primaryText) {
                    navigator.pop()
                }
            }

            ToolbarItem(placement: .principal) {
                SystemSegmentedTabs(
                    items: LiveLobbyTab.allCases,
                    selection: $selectedTab,
                    title: { $0.title },
                    accessibilityIdentifier: "live.lobby.tabs",
                    fontWeight: .medium
                )
                .frame(width: 196)
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Group {
                    if isCurrentUserLive {
                        Button(action: presentExitDialog) {
                            Text("退出")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(AppColors.errorColor)
                                .frame(minWidth: 42, minHeight: 34)
                        }
                        .accessibilityLabel("退出直播")
                        .transition(.opacity.combined(with: .scale(scale: 0.86)))
                    } else {
                        Button(action: presentStartDialog) {
                            Image(systemName: "plus")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(AppColors.primaryText)
                                .frame(width: 34, height: 34)
                        }
                        .accessibilityLabel("挂上直播")
                        .transition(.opacity.combined(with: .scale(scale: 0.86)))
                    }
                }
                .buttonStyle(.plain)
                .animation(.easeInOut(duration: 0.2), value: isCurrentUserLive)
            }
        }
        .task(id: "\(selectedTab.rawValue):\(authManager.currentUser?.userID ?? "guest")") {
            while !Task.isCancelled {
                await store.refresh(tab: selectedTab, user: authManager.currentUser)
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
        .refreshable {
            await store.refresh(tab: selectedTab, user: authManager.currentUser)
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task {
                await store.refresh(tab: selectedTab, user: authManager.currentUser)
            }
        }
        .onReceive(WebSocketService.shared.liveSlotCreatedPublisher) { data in
            store.applySlotEvent(
                .created,
                data: data,
                tab: selectedTab,
                user: authManager.currentUser
            )
        }
        .onReceive(WebSocketService.shared.liveSlotUpdatedPublisher) { data in
            store.applySlotEvent(
                .updated,
                data: data,
                tab: selectedTab,
                user: authManager.currentUser
            )
        }
        .onReceive(WebSocketService.shared.liveSlotEndedPublisher) { data in
            store.applySlotEvent(
                .ended,
                data: data,
                tab: selectedTab,
                user: authManager.currentUser
            )
        }
        .toast(message: $store.errorMessage, duration: 4)
        .onReceive(NotificationCenter.default.publisher(for: .resetLiveLobbyNavigation)) { _ in
            navigator.resetToRoot()
        }
        .onDisappear {
            guard presentedDialog != nil else { return }
            dismissDialog(animated: false)
        }
    }

    private func presentStartDialog() {
        guard presentedDialog == nil, !isCurrentUserLive else { return }
        presentedDialog = .start
        navigator.presentAppModalOverlay {
            LiveStartDialog(
                initialRole: "",
                fallbackAvatarURL: authManager.currentUser?.avatarURL ?? "",
                onStart: startLive,
                onDismiss: { dismissDialog() }
            )
        }
    }

    private func presentExitDialog() {
        guard presentedDialog == nil, isCurrentUserLive else { return }
        presentedDialog = .exit
        navigator.presentAppModalOverlay {
            LiveExitDialog(
                onConfirm: stopLive,
                onDismiss: { dismissDialog() }
            )
        }
    }

    private func presentParticipantDialog(
        _ participant: LiveLobbyParticipant,
        preferredCallType: CallType?
    ) {
        guard presentedDialog == nil else { return }
        presentedDialog = .participant(
            participant,
            preferredCallType: preferredCallType
        )
        navigator.presentAppModalOverlay {
            LiveParticipantDialog(
                participant: participant,
                isCurrentUserLive: isCurrentUserLive,
                billingPolicy: store.billingPolicy,
                supportedCallTypes: store.supportedCallTypes,
                preferredCallType: preferredCallType,
                onCall: { callType, paymentMethod in
                    requestCall(callType, paymentMethod: paymentMethod, with: participant)
                },
                onDismiss: { dismissDialog() }
            )
        }
    }

    private func requestCall(
        _ callType: CallType,
        paymentMethod: LiveCallPaymentMethod,
        with participant: LiveLobbyParticipant
    ) {
        guard !participant.isCurrentUser else {
            dismissDialog()
            store.errorMessage = "这是你的直播，其他用户可以从这里与你连线"
            return
        }
        guard participant.availability.canReceiveCalls else {
            dismissDialog()
            store.errorMessage = participant.availability.detailText
            return
        }
        guard store.supportedCallTypes.contains(callType) else {
            dismissDialog()
            store.errorMessage = callType == .voice
                ? "当前服务暂未开放语音连线"
                : "当前服务暂未开放视频连线"
            return
        }
        guard participant.allowedCallTypes?.contains(callType) ?? true else {
            dismissDialog()
            store.errorMessage = "该主播未开放\(callType == .voice ? "语音" : "视频")连线"
            return
        }
        guard LiveCallInitiationPolicy.canInitiate(isCurrentUserLive: isCurrentUserLive) else {
            dismissDialog()
            store.errorMessage = LiveCallInitiationPolicy.liveLobbyHostingBlockMessage
            return
        }
        let peer = LiveCallPeer(
            userID: participant.userID,
            username: participant.displayName,
            avatarURL: participant.avatarURL,
            characterSetting: participant.roleSetting
        )
        dismissDialog()
        LiveCallCoordinator.shared.requestCall(
            slotID: participant.id,
            peer: peer,
            callType: callType,
            billingPolicy: store.billingPolicy,
            paymentMethod: paymentMethod
        )
    }

    private func startLive(
        roleSetting: String,
        liveAvatarData: Data?,
        allowedCallTypes: [CallType],
        avatarUploadIdempotencyKey: UUID,
        slotCreationIdempotencyKey: UUID
    ) async -> Bool {
        guard let participant = await store.startLive(
            roleSetting: roleSetting,
            liveAvatarData: liveAvatarData,
            allowedCallTypes: allowedCallTypes,
            avatarUploadIdempotencyKey: avatarUploadIdempotencyKey,
            slotCreationIdempotencyKey: slotCreationIdempotencyKey,
            user: authManager.currentUser
        ) else { return false }
        selectedTab = .recommended
        newlyStartedParticipantID = participant.id
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        dismissDialog()

        try? await Task.sleep(nanoseconds: 1_200_000_000)
        if newlyStartedParticipantID == participant.id {
            newlyStartedParticipantID = nil
        }
        return true
    }

    private func stopLive() {
        Task {
            guard await store.stopCurrentUserLive(user: authManager.currentUser) else { return }
            newlyStartedParticipantID = nil
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            dismissDialog()
        }
    }

    private func dismissDialog(animated: Bool = true) {
        presentedDialog = nil
        navigator.dismissAppOverlay(animated: animated)
    }
}

private struct LiveLobbyPricingBanner: View {
    let policy: LiveBillingPolicy
    let supportedCallTypes: [CallType]

    private var title: String {
        supportedCallTypes.contains(.voice)
            ? "语音 / 视频统一计费"
            : "视频连线计费"
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "pawprint.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundColor(AppColors.accent)
                .frame(width: 30, height: 30)
                .background(AppColors.accentLight, in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(AppColors.primaryText)
                Text(policy.fullRuleText)
                    .font(.caption)
                    .foregroundColor(AppColors.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title)，\(policy.fullRuleText)")
    }
}

private struct LiveLobbyEmptyState: View {
    let tab: LiveLobbyTab

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: tab == .recommended ? "person.2.slash" : "bubble.left.and.bubble.right")
                .font(.system(size: 34, weight: .medium))
                .foregroundColor(AppColors.tertiaryText)
            Text(tab == .recommended ? "暂时没有在线直播" : "还没有聊过的直播对象")
                .font(.headline)
                .foregroundColor(AppColors.primaryText)
            Text(tab == .recommended ? "稍后刷新看看，或点击右上角挂上直播" : "成功连线后会出现在这里")
                .font(.subheadline)
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 260)
        .padding(.horizontal, 24)
        .accessibilityElement(children: .combine)
    }
}

private struct LiveLobbySkeletonCard: View {
    var body: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 0)
                .fill(Color(.systemGray5))
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(.systemGray5))
                    .frame(width: 72, height: 10)
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(.systemGray5))
                    .frame(height: 12)
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(.systemGray5))
                    .frame(width: 96, height: 12)
            }
            .padding(10)
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(.systemGray5))
                    .frame(height: 54)
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(.systemGray5))
                    .frame(height: 54)
            }
            .padding(8)
        }
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .redacted(reason: .placeholder)
    }
}

private struct LiveLobbyCoverImage: View {
    let url: String
    let initials: String
    let placeholderGradient: LinearGradient

    @State private var image: UIImage?

    private var resolvedPath: String {
        MediaURLResolver.resolve(url)?.absoluteString ?? ""
    }

    init(
        url: String,
        initials: String,
        placeholderGradient: LinearGradient
    ) {
        self.url = url
        self.initials = initials
        self.placeholderGradient = placeholderGradient

        let path = MediaURLResolver.resolve(url)?.absoluteString ?? ""
        _image = State(
            initialValue: path.isEmpty
                ? nil
                : ImageCacheManager.shared.image(for: path)
        )
    }

    var body: some View {
        ZStack {
            placeholderGradient
                .overlay {
                    Text(initials)
                        .font(.largeTitle.weight(.semibold))
                        .foregroundColor(.white.opacity(0.94))
                }

            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .transaction { transaction in
            transaction.animation = nil
        }
        .task(id: url) {
            let requestedPath = resolvedPath
            guard !requestedPath.isEmpty else {
                image = nil
                return
            }
            if let cached = ImageCacheManager.shared.image(for: requestedPath) {
                image = cached
                return
            }

            image = nil
            let loaded = await ImageCacheManager.shared.loadImage(from: requestedPath)
            guard !Task.isCancelled, requestedPath == resolvedPath else { return }
            image = loaded
        }
    }
}

private struct LiveLobbyAvatarCell: View {
    let participant: LiveLobbyParticipant
    let isNewlyStarted: Bool
    let onOpen: () -> Void

    private var initials: String {
        String(participant.displayName.prefix(1))
    }

    private var placeholderGradient: LinearGradient {
        let palettes: [[Color]] = [
            [Color(hex: "FF7A9E"), Color(hex: "FFB36B")],
            [Color(hex: "7C8CFF"), Color(hex: "A86BF2")],
            [Color(hex: "35C8C2"), Color(hex: "62A8FF")],
            [Color(hex: "FF8A65"), Color(hex: "E85D9E")],
            [Color(hex: "5D8BFF"), Color(hex: "7BD5FF")],
            [Color(hex: "71C777"), Color(hex: "D1B74A")],
            [Color(hex: "9B6DFF"), Color(hex: "FF70A6")]
        ]
        let colors = palettes[abs(participant.paletteIndex) % palettes.count]
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                onOpen()
            } label: {
                GeometryReader { proxy in
                    ZStack(alignment: .bottomLeading) {
                        LiveLobbyCoverImage(
                            url: participant.avatarURL,
                            initials: initials,
                            placeholderGradient: placeholderGradient
                        )
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .clipped()

                        LinearGradient(
                            colors: [.clear, Color.black.opacity(0.78)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(height: proxy.size.height * 0.56)
                        .allowsHitTesting(false)

                    HStack(spacing: 6) {
                        Text(participant.displayName)
                            .font(.headline)
                            .foregroundColor(.white)
                            .lineLimit(1)

                        Text("\(participant.gender.symbol) \(participant.gender.text)")
                            .font(.caption2.weight(.semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(
                                participant.gender.color.opacity(0.88),
                                in: Capsule()
                            )
                            .fixedSize(horizontal: true, vertical: false)
                            .layoutPriority(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(11)

                        Label {
                            Text(participant.availability.displayText)
                        } icon: {
                            Circle()
                                .fill(participant.availability.color)
                                .frame(width: 7, height: 7)
                        }
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .frame(height: 22)
                        .background(Color.black.opacity(0.48), in: Capsule())
                        .padding(9)
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity,
                            alignment: .topLeading
                        )

                        Text(participant.isCurrentUser ? "我的直播" : "LIVE")
                            .font(.caption2.weight(.bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .frame(height: 22)
                            .background(AppColors.accent.opacity(0.92), in: Capsule())
                            .padding(9)
                            .frame(
                                maxWidth: .infinity,
                                maxHeight: .infinity,
                                alignment: .topTrailing
                            )
                    }
                }
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                "\(participant.displayName)，性别\(participant.gender.text)，"
                    + "\(participant.availability.displayText)，\(participant.roleSetting)"
            )

            Button {
                onOpen()
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(participant.isCurrentUser ? "我所扮演：" : "TA 所扮演：")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(AppColors.secondaryText)
                    Text(participant.roleSetting.isEmpty ? "未填写人物设定" : participant.roleSetting)
                        .font(.caption)
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, minHeight: 54, alignment: .topLeading)
                .padding(.horizontal, 10)
                .padding(.vertical, 9)
                .background(AppColors.cardBackground)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                "\(participant.isCurrentUser ? "我所扮演" : "TA 所扮演")，"
                    + "\(participant.roleSetting)"
            )
        }
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(
            color: isNewlyStarted
                ? AppColors.accent.opacity(0.30)
                : Color.black.opacity(0.08),
            radius: isNewlyStarted ? 14 : 8,
            x: 0,
            y: 4
        )
        .scaleEffect(isNewlyStarted ? 1.025 : 1)
        .animation(.spring(response: 0.42, dampingFraction: 0.72), value: isNewlyStarted)
    }
}

private struct LiveParticipantDialog: View {
    let participant: LiveLobbyParticipant
    let isCurrentUserLive: Bool
    let billingPolicy: LiveBillingPolicy
    let supportedCallTypes: [CallType]
    let onCall: (CallType, LiveCallPaymentMethod) -> Void
    let onDismiss: () -> Void

    @ObservedObject private var propStore = PropInventoryStore.shared
    @State private var preferredCallType: CallType?
    @State private var paymentCallType: CallType?
    @State private var isLoadingPaymentOptions = true

    init(
        participant: LiveLobbyParticipant,
        isCurrentUserLive: Bool,
        billingPolicy: LiveBillingPolicy,
        supportedCallTypes: [CallType],
        preferredCallType: CallType?,
        onCall: @escaping (CallType, LiveCallPaymentMethod) -> Void,
        onDismiss: @escaping () -> Void
    ) {
        self.participant = participant
        self.isCurrentUserLive = isCurrentUserLive
        self.billingPolicy = billingPolicy
        self.supportedCallTypes = supportedCallTypes
        self.onCall = onCall
        self.onDismiss = onDismiss
        _preferredCallType = State(initialValue: preferredCallType)
    }

    private var callsAreBlocked: Bool {
        participant.isCurrentUser
            || isCurrentUserLive
            || !participant.availability.canReceiveCalls
    }

    private var availableCallTypes: [CallType] {
        LiveSlotCallTypePolicy.effective(
            globallySupported: supportedCallTypes,
            hostAllowed: participant.allowedCallTypes
        )
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.34)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: onDismiss)

            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    AvatarView(url: participant.avatarURL, size: 76)
                        .clipShape(Circle())
                        .overlay { Circle().stroke(AppColors.cardBackground, lineWidth: 2) }
                        .shadow(color: Color.black.opacity(0.12), radius: 10, y: 4)

                    VStack(alignment: .leading, spacing: 7) {
                        Text(participant.displayName)
                            .font(.title3.weight(.semibold))
                            .foregroundColor(AppColors.primaryText)
                            .lineLimit(2)

                        Text("\(participant.gender.symbol) \(participant.gender.text)")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(participant.gender.color)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(
                                participant.gender.color.opacity(0.12),
                                in: Capsule()
                            )

                        Label {
                            Text(participant.availability.displayText)
                        } icon: {
                            Circle()
                                .fill(participant.availability.color)
                                .frame(width: 8, height: 8)
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundColor(participant.availability.color)
                    }

                    Spacer(minLength: 0)
                }

                VStack(alignment: .leading, spacing: 7) {
                    Text(participant.isCurrentUser ? "我扮演的角色" : "TA 扮演的角色")
                        .font(.caption.weight(.medium))
                        .foregroundColor(AppColors.secondaryText)

                    Text(participant.roleSetting.isEmpty ? "未填写人物设定" : participant.roleSetting)
                        .font(.subheadline)
                        .foregroundColor(AppColors.primaryText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppColors.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                .padding(.top, 18)

                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "pawprint.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(AppColors.accent)
                        .padding(.top, 1)
                    Text(billingPolicy.fullRuleText)
                        .font(.caption)
                        .foregroundColor(AppColors.secondaryText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(12)
                .background(AppColors.accentLight)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.top, 12)

                if participant.isCurrentUser
                    || isCurrentUserLive
                    || !participant.availability.canReceiveCalls {
                    Text(
                        participant.isCurrentUser
                            ? "这是你的直播，其他用户可以从这里与你连线"
                            : isCurrentUserLive
                                ? LiveCallInitiationPolicy.liveLobbyHostingBlockMessage
                                : participant.availability.detailText
                    )
                    .font(.caption.weight(.medium))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .padding(.top, 12)
                }

                if let paymentCallType {
                    LiveCallPaymentChoiceView(
                        callType: paymentCallType,
                        policy: billingPolicy,
                        availableCards: propStore.availableLiveExperienceCards,
                        quantity: { propStore.quantity(for: $0) },
                        onSelect: { onCall(paymentCallType, $0) },
                        onBack: { self.paymentCallType = nil }
                    )
                    .padding(.top, 16)
                } else if availableCallTypes.isEmpty {
                    Text("该主播暂未开放连线")
                        .font(.caption.weight(.medium))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                } else {
                    HStack(spacing: 10) {
                        if availableCallTypes.contains(.voice) {
                            LiveDialogCallButton(
                                callType: .voice,
                                policy: billingPolicy,
                                isSupported: true,
                                isBlocked: callsAreBlocked || isLoadingPaymentOptions,
                                isPreferred: preferredCallType == .voice,
                                action: { choosePayment(for: .voice) }
                            )
                        }
                        if availableCallTypes.contains(.video) {
                            LiveDialogCallButton(
                                callType: .video,
                                policy: billingPolicy,
                                isSupported: true,
                                isBlocked: callsAreBlocked || isLoadingPaymentOptions,
                                isPreferred: preferredCallType == .video,
                                action: { choosePayment(for: .video) }
                            )
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 16)
                }

                Button("取消", action: onDismiss)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(AppColors.secondaryText)
                    .buttonStyle(.plain)
                    .frame(height: 40)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 20)
            .padding(.top, 22)
            .padding(.bottom, 12)
            .frame(maxWidth: 360)
            .background(AppColors.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.72), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .shadow(color: Color.black.opacity(0.18), radius: 24, x: 0, y: 10)
            .padding(.horizontal, 18)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            await propStore.load()
            guard !Task.isCancelled else { return }
            isLoadingPaymentOptions = false
        }
    }

    private func choosePayment(for callType: CallType) {
        if propStore.availableLiveExperienceCards.isEmpty {
            onCall(callType, .spendableBalance)
        } else {
            paymentCallType = callType
        }
    }
}

private struct LiveCallPaymentChoiceView: View {
    let callType: CallType
    let policy: LiveBillingPolicy
    let availableCards: [LiveExperienceCardKind]
    let quantity: (LiveExperienceCardKind) -> Int
    let onSelect: (LiveCallPaymentMethod) -> Void
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 9) {
            HStack {
                Button(action: onBack) {
                    Label(L10n.tr("common.back"), systemImage: "chevron.left")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundColor(AppColors.secondaryText)

                Spacer()

                Text(L10n.tr(
                    "live.experience.payment.title",
                    callType == .voice
                        ? L10n.tr("live.experience.callType.voice")
                        : L10n.tr("live.experience.callType.video")
                ))
                .font(.subheadline.weight(.semibold))
                .foregroundColor(AppColors.primaryText)
            }

            ForEach(availableCards) { kind in
                paymentRow(
                    title: kind.localizedName,
                    subtitle: L10n.tr("live.experience.payment.available", quantity(kind)),
                    isPrimary: true,
                    action: { onSelect(.experienceCard(kind)) }
                ) {
                        LiveExperienceCardArtwork(kind: kind)
                            .frame(width: 42, height: 42)
                }
            }

            paymentRow(
                title: L10n.tr("live.experience.payment.balance"),
                subtitle: policy.fullRuleText,
                isPrimary: false,
                action: { onSelect(.spendableBalance) }
            ) {
                    Image("activity_cat_food_icon")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 36, height: 36)
            }

            Label(L10n.tr("live.experience.payment.rule"), systemImage: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
        }
    }

    private func paymentRow<Artwork: View>(
        title: String,
        subtitle: String,
        isPrimary: Bool,
        action: @escaping () -> Void,
        @ViewBuilder artwork: () -> Artwork
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 11) {
                artwork()
                    .frame(width: 44, height: 44)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                    Text(subtitle)
                        .font(.system(size: 10, weight: .medium))
                        .opacity(0.78)
                        .lineLimit(2)
                }

                Spacer(minLength: 5)

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
            }
            .foregroundColor(isPrimary ? .white : AppColors.primaryText)
            .padding(.horizontal, 11)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 54)
            .background(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(isPrimary ? AppColors.accent : AppColors.secondaryBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(isPrimary ? Color.clear : AppColors.separator, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(subtitle)")
    }
}

private struct LiveDialogCallButton: View {
    let callType: CallType
    let policy: LiveBillingPolicy
    let isSupported: Bool
    let isBlocked: Bool
    let isPreferred: Bool
    let action: () -> Void

    private var isEnabled: Bool {
        isSupported && !isBlocked
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: callType == .voice ? "phone.fill" : "video.fill")
                    .font(.subheadline.weight(.semibold))
                Text("确认\(callType == .voice ? "语音" : "视频")")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Text(isSupported ? policy.compactRateText : "暂未开放")
                    .font(.caption2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
            .foregroundColor(isEnabled ? .white : AppColors.secondaryText)
            .frame(maxWidth: .infinity)
            .frame(height: 66)
            .background(
                isEnabled
                    ? AnyShapeStyle(AppColors.accentGradient)
                    : AnyShapeStyle(AppColors.secondaryBackground)
            )
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay {
                if isPreferred && isEnabled {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(Color.white.opacity(0.94), lineWidth: 2)
                        .padding(2)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }
}

struct LiveAvatarCropDraft: Identifiable {
    let id = UUID()
    let image: UIImage
}

enum LiveAvatarCropRenderer {
    static let maximumZoom: CGFloat = 5

    static func normalizedImage(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up || image.scale != 1 else { return image }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }

    static func minimumScale(imageSize: CGSize, viewportSide: CGFloat) -> CGFloat {
        guard imageSize.width > 0, imageSize.height > 0, viewportSide > 0 else { return 1 }
        return max(viewportSide / imageSize.width, viewportSide / imageSize.height)
    }

    static func clampedOffset(
        _ offset: CGSize,
        imageSize: CGSize,
        viewportSide: CGFloat,
        zoom: CGFloat
    ) -> CGSize {
        let baseScale = minimumScale(imageSize: imageSize, viewportSide: viewportSide)
        let safeZoom = min(max(zoom, 1), maximumZoom)
        let displayedWidth = imageSize.width * baseScale * safeZoom
        let displayedHeight = imageSize.height * baseScale * safeZoom
        let maximumX = max((displayedWidth - viewportSide) / 2, 0)
        let maximumY = max((displayedHeight - viewportSide) / 2, 0)
        return CGSize(
            width: min(max(offset.width, -maximumX), maximumX),
            height: min(max(offset.height, -maximumY), maximumY)
        )
    }

    static func cropRect(
        imageSize: CGSize,
        viewportSide: CGFloat,
        zoom: CGFloat,
        offset: CGSize
    ) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, viewportSide > 0 else {
            return .zero
        }
        let safeZoom = min(max(zoom, 1), maximumZoom)
        let displayScale = minimumScale(
            imageSize: imageSize,
            viewportSide: viewportSide
        ) * safeZoom
        let side = min(
            viewportSide / displayScale,
            min(imageSize.width, imageSize.height)
        )
        let safeOffset = clampedOffset(
            offset,
            imageSize: imageSize,
            viewportSide: viewportSide,
            zoom: safeZoom
        )
        let center = CGPoint(
            x: imageSize.width / 2 - safeOffset.width / displayScale,
            y: imageSize.height / 2 - safeOffset.height / displayScale
        )
        let originX = min(max(center.x - side / 2, 0), imageSize.width - side)
        let originY = min(max(center.y - side / 2, 0), imageSize.height - side)
        return CGRect(x: originX, y: originY, width: side, height: side)
    }

    static func croppedJPEG(
        image: UIImage,
        viewportSide: CGFloat,
        zoom: CGFloat,
        offset: CGSize,
        maxBytes: Int = 1_000_000
    ) -> Data? {
        let normalized = normalizedImage(image)
        guard let source = normalized.cgImage else { return nil }
        let rect = cropRect(
            imageSize: normalized.size,
            viewportSide: viewportSide,
            zoom: zoom,
            offset: offset
        )
        let bounded = rect.integral.intersection(
            CGRect(
                x: 0,
                y: 0,
                width: CGFloat(source.width),
                height: CGFloat(source.height)
            )
        )
        guard bounded.width > 0,
              bounded.height > 0,
              let cropped = source.cropping(to: bounded) else { return nil }

        let sourceImage = UIImage(cgImage: cropped)
        let targetSide = min(CGFloat(1024), max(1, bounded.width))
        let targetSize = CGSize(width: targetSide, height: targetSide)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
            sourceImage.draw(in: CGRect(origin: .zero, size: targetSize))
        }
        var smallest: Data?
        for quality in [0.86, 0.78, 0.70, 0.62, 0.54] as [CGFloat] {
            guard let data = rendered.jpegData(compressionQuality: quality) else { continue }
            smallest = data
            if data.count <= maxBytes {
                return data
            }
        }
        return smallest
    }
}

private struct LiveStartDialog: View {
    @State private var role: String
    @State private var isRoleFocused = false
    @State private var hasVisibleRoleText: Bool
    @State private var allowsVoiceCalls = false
    @State private var allowsVideoCalls = false
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var cropDraft: LiveAvatarCropDraft?
    @State private var croppedAvatarData: Data?
    @State private var isReadingPhoto = false
    @State private var isSubmitting = false
    @State private var validationMessage: String?
    @State private var avatarUploadIdempotencyKey = UUID()
    @State private var slotCreationIdempotencyKey = UUID()

    let fallbackAvatarURL: String
    let onStart: (String, Data?, [CallType], UUID, UUID) async -> Bool
    let onDismiss: () -> Void

    init(
        initialRole: String,
        fallbackAvatarURL: String,
        onStart: @escaping (String, Data?, [CallType], UUID, UUID) async -> Bool,
        onDismiss: @escaping () -> Void
    ) {
        _role = State(initialValue: initialRole)
        _hasVisibleRoleText = State(initialValue: !initialRole.isEmpty)
        self.fallbackAvatarURL = fallbackAvatarURL
        self.onStart = onStart
        self.onDismiss = onDismiss
    }

    private var trimmedRole: String {
        role.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSubmit: Bool {
        !trimmedRole.isEmpty
            && !selectedCallTypes.isEmpty
            && !isReadingPhoto
            && !isSubmitting
    }

    private var selectedCallTypes: [CallType] {
        LiveSlotCallTypePolicy.selectionOrder.filter { callType in
            switch callType {
            case .voice: return allowsVoiceCalls
            case .video: return allowsVideoCalls
            }
        }
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.34)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {
                    if isRoleFocused {
                        isRoleFocused = false
                        hideKeyboard()
                    } else if !isSubmitting {
                        onDismiss()
                    }
                }

            VStack(alignment: .leading, spacing: 16) {
                Text("我扮演的")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)

                liveAvatarSection

                ZStack(alignment: .topLeading) {
                    LiveRoleTextView(
                        text: $role,
                        isFocused: $isRoleFocused,
                        hasVisibleText: $hasVisibleRoleText
                    )
                        .padding(.horizontal, 12)
                        .frame(height: 172)

                    if !hasVisibleRoleText {
                        Text("输入我扮演的人物设定")
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.tertiaryText)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 14)
                            .allowsHitTesting(false)
                    }
                }
                .frame(height: 184)
                .background(AppColors.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(
                            isRoleFocused ? AppColors.accent.opacity(0.72) : AppColors.separator,
                            lineWidth: isRoleFocused ? 1.5 : 1
                        )
                        .allowsHitTesting(false)
                }
                .animation(.easeOut(duration: 0.16), value: isRoleFocused)

                callTypeSelectionSection

                Button {
                    Task { await startLive() }
                } label: {
                    HStack(spacing: 8) {
                        if isSubmitting {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "dot.radiowaves.left.and.right")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        Text(isSubmitting ? "正在挂上直播…" : "挂上直播")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(AppColors.accentGradient)
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!canSubmit)
                .opacity(canSubmit ? 1 : 0.5)
            }
            .padding(20)
            .frame(maxWidth: 344)
            .background(AppColors.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.72), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .shadow(color: Color.black.opacity(0.18), radius: 24, x: 0, y: 10)
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            KeyboardDismissTapInstaller(
                isEnabled: isRoleFocused,
                consumesOutsideTaps: false,
                dismissesOnControls: true
            ) {
                isRoleFocused = false
                hideKeyboard()
            }
        )
        .fullScreenCover(item: $cropDraft) { draft in
            LiveAvatarCropView(image: draft.image) { data in
                croppedAvatarData = data
                avatarUploadIdempotencyKey = UUID()
                slotCreationIdempotencyKey = UUID()
            }
        }
        .toast(message: $validationMessage, duration: 3)
        .onChange(of: selectedPhoto) { item in
            guard let item else { return }
            Task { await loadPhoto(item) }
        }
        .onChange(of: role) { _ in
            slotCreationIdempotencyKey = UUID()
        }
        .onChange(of: allowsVoiceCalls) { _ in
            slotCreationIdempotencyKey = UUID()
        }
        .onChange(of: allowsVideoCalls) { _ in
            slotCreationIdempotencyKey = UUID()
        }
        .onDisappear {
            isRoleFocused = false
            hideKeyboard()
        }
    }

    private var callTypeSelectionSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("允许的连线方式")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.primaryText)

            HStack(spacing: 10) {
                LiveCallTypeCheckbox(
                    callType: .voice,
                    isSelected: $allowsVoiceCalls
                )
                LiveCallTypeCheckbox(
                    callType: .video,
                    isSelected: $allowsVideoCalls
                )
            }

            Text(
                selectedCallTypes.isEmpty
                    ? "请至少勾选一种连线方式"
                    : "观众只能使用你勾选的方式发起连线"
            )
            .font(.caption)
            .foregroundColor(
                selectedCallTypes.isEmpty
                    ? AppColors.errorColor
                    : AppColors.secondaryText
            )
        }
        .disabled(isSubmitting)
        .accessibilityElement(children: .contain)
    }

    private var liveAvatarSection: some View {
        HStack(spacing: 14) {
            Group {
                if let croppedAvatarData,
                   let image = UIImage(data: croppedAvatarData) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    AvatarView(url: fallbackAvatarURL, size: 72)
                }
            }
            .frame(width: 72, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(AppColors.accent.opacity(0.28), lineWidth: 1)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("直播头像（可选）")
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(AppColors.primaryText)

                HStack(spacing: 12) {
                    PhotosPicker(selection: $selectedPhoto, matching: .images) {
                        Text(croppedAvatarData == nil ? "选择图片" : "重新选择")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(AppColors.accent)
                    }
                    .disabled(isReadingPhoto || isSubmitting)

                    if croppedAvatarData != nil {
                        Button("移除") {
                            croppedAvatarData = nil
                            selectedPhoto = nil
                            avatarUploadIdempotencyKey = UUID()
                            slotCreationIdempotencyKey = UUID()
                        }
                        .font(.caption.weight(.medium))
                        .foregroundColor(AppColors.errorColor)
                        .buttonStyle(.plain)
                        .disabled(isSubmitting)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(AppColors.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @MainActor
    private func loadPhoto(_ item: PhotosPickerItem) async {
        isReadingPhoto = true
        defer {
            isReadingPhoto = false
            selectedPhoto = nil
        }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else {
            validationMessage = "无法读取所选图片，请重新选择"
            return
        }
        cropDraft = LiveAvatarCropDraft(
            image: LiveAvatarCropRenderer.normalizedImage(image)
        )
    }

    @MainActor
    private func startLive() async {
        guard canSubmit else { return }
        isRoleFocused = false
        hideKeyboard()
        isSubmitting = true
        let succeeded = await onStart(
            trimmedRole,
            croppedAvatarData,
            selectedCallTypes,
            avatarUploadIdempotencyKey,
            slotCreationIdempotencyKey
        )
        if !succeeded {
            isSubmitting = false
        }
    }
}

private struct LiveCallTypeCheckbox: View {
    let callType: CallType
    @Binding var isSelected: Bool

    var body: some View {
        Toggle(isOn: $isSelected) {
            Label(
                callType == .voice ? "语音" : "视频",
                systemImage: callType == .voice ? "phone.fill" : "video.fill"
            )
            .font(.subheadline.weight(.semibold))
        }
        .toggleStyle(LiveCheckboxToggleStyle())
        .accessibilityHint("双击切换是否允许该连线方式")
    }
}

private struct LiveCheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 9) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundColor(
                        configuration.isOn
                            ? AppColors.accent
                            : AppColors.tertiaryText
                    )

                configuration.label
                    .foregroundColor(AppColors.primaryText)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(
                configuration.isOn
                    ? AppColors.accentLight
                    : AppColors.secondaryBackground
            )
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(
                        configuration.isOn
                            ? AppColors.accent.opacity(0.42)
                            : AppColors.separator,
                        lineWidth: 1
                    )
            }
        }
        .buttonStyle(.plain)
        .accessibilityValue(configuration.isOn ? "已勾选" : "未勾选")
    }
}

private struct LiveAvatarCropView: View {
    @Environment(\.dismiss) private var dismiss

    let image: UIImage
    let onConfirm: (Data) -> Void

    @State private var committedZoom: CGFloat = 1
    @State private var gestureZoom: CGFloat = 1
    @State private var committedOffset: CGSize = .zero
    @State private var dragTranslation: CGSize = .zero
    @State private var errorMessage: String?

    private var effectiveZoom: CGFloat {
        min(max(committedZoom * gestureZoom, 1), LiveAvatarCropRenderer.maximumZoom)
    }

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                let cropSide = min(proxy.size.width - 32, proxy.size.height * 0.58)
                let baseScale = LiveAvatarCropRenderer.minimumScale(
                    imageSize: image.size,
                    viewportSide: cropSide
                )
                let displayedSize = CGSize(
                    width: image.size.width * baseScale,
                    height: image.size.height * baseScale
                )
                let proposedOffset = CGSize(
                    width: committedOffset.width + dragTranslation.width,
                    height: committedOffset.height + dragTranslation.height
                )
                let effectiveOffset = LiveAvatarCropRenderer.clampedOffset(
                    proposedOffset,
                    imageSize: image.size,
                    viewportSide: cropSide,
                    zoom: effectiveZoom
                )

                VStack(spacing: 22) {
                    Spacer(minLength: 18)

                    ZStack {
                        Color.black
                        Image(uiImage: image)
                            .resizable()
                            .frame(width: displayedSize.width, height: displayedSize.height)
                            .scaleEffect(effectiveZoom)
                            .offset(effectiveOffset)
                    }
                    .frame(width: cropSide, height: cropSide)
                    .clipped()
                    .overlay {
                        Rectangle()
                            .stroke(Color.white, lineWidth: 2)
                    }
                    .overlay {
                        RuleOfThirdsGrid()
                            .stroke(Color.white.opacity(0.38), lineWidth: 0.7)
                    }
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture()
                            .onChanged { dragTranslation = $0.translation }
                            .onEnded { value in
                                committedOffset = LiveAvatarCropRenderer.clampedOffset(
                                    CGSize(
                                        width: committedOffset.width + value.translation.width,
                                        height: committedOffset.height + value.translation.height
                                    ),
                                    imageSize: image.size,
                                    viewportSide: cropSide,
                                    zoom: effectiveZoom
                                )
                                dragTranslation = .zero
                            }
                    )
                    .simultaneousGesture(
                        MagnificationGesture()
                            .onChanged { gestureZoom = $0 }
                            .onEnded { value in
                                committedZoom = min(
                                    max(committedZoom * value, 1),
                                    LiveAvatarCropRenderer.maximumZoom
                                )
                                gestureZoom = 1
                                committedOffset = LiveAvatarCropRenderer.clampedOffset(
                                    committedOffset,
                                    imageSize: image.size,
                                    viewportSide: cropSide,
                                    zoom: committedZoom
                                )
                            }
                    )

                    VStack(spacing: 8) {
                        Text("拖动图片调整位置，双指缩放")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.86))
                        Button("重置") {
                            withAnimation(.easeOut(duration: 0.2)) {
                                committedZoom = 1
                                gestureZoom = 1
                                committedOffset = .zero
                                dragTranslation = .zero
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(AppColors.accent)
                    }

                    Spacer(minLength: 16)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.ignoresSafeArea())
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("取消") { dismiss() }
                            .foregroundColor(.white)
                    }
                    ToolbarItem(placement: .principal) {
                        Text("裁剪直播头像")
                            .font(.headline)
                            .foregroundColor(.white)
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("使用") {
                            guard let data = LiveAvatarCropRenderer.croppedJPEG(
                                image: image,
                                viewportSide: cropSide,
                                zoom: effectiveZoom,
                                offset: effectiveOffset
                            ) else {
                                errorMessage = "图片裁剪失败，请重新选择"
                                return
                            }
                            onConfirm(data)
                            dismiss()
                        }
                        .fontWeight(.semibold)
                        .foregroundColor(AppColors.accent)
                    }
                }
            }
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .preferredColorScheme(.dark)
        .toast(message: $errorMessage, duration: 3)
    }
}

private struct RuleOfThirdsGrid: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        for fraction in [CGFloat(1) / 3, CGFloat(2) / 3] {
            let x = rect.width * fraction
            let y = rect.height * fraction
            path.move(to: CGPoint(x: x, y: 0))
            path.addLine(to: CGPoint(x: x, y: rect.height))
            path.move(to: CGPoint(x: 0, y: y))
            path.addLine(to: CGPoint(x: rect.width, y: y))
        }
        return path
    }
}

private struct LiveExitDialog: View {
    let onConfirm: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.34)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: onDismiss)

            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(AppColors.errorColor.opacity(0.12))
                        .frame(width: 58, height: 58)

                    Image(systemName: "video.slash.fill")
                        .font(.system(size: 23, weight: .semibold))
                        .foregroundColor(AppColors.errorColor)
                }

                Text("退出直播？")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .padding(.top, 14)

                Text("退出后，你的头像将从直播列表中移除；如果正在一对一通话，通话也会同时结束。")
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .padding(.top, 8)

                Button(action: onConfirm) {
                    Text("退出直播")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .background(AppColors.errorColor)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.top, 20)

                Button("继续直播", action: onDismiss)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .buttonStyle(.plain)
                    .frame(height: 40)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 20)
            .padding(.top, 22)
            .padding(.bottom, 12)
            .frame(maxWidth: 330)
            .background(AppColors.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.72), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .shadow(color: Color.black.opacity(0.18), radius: 24, x: 0, y: 10)
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
    }
}

private struct LiveRoleTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    @Binding var hasVisibleText: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.font = .systemFont(ofSize: 16)
        textView.textColor = UIColor(AppColors.primaryText)
        textView.tintColor = UIColor(AppColors.accent)
        textView.textContainerInset = UIEdgeInsets(top: 10, left: 0, bottom: 10, right: 0)
        textView.textContainer.lineFragmentPadding = 0
        textView.returnKeyType = .default
        textView.keyboardDismissMode = .interactive
        textView.isScrollEnabled = true
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        if textView.text != text, textView.markedTextRange == nil {
            textView.text = text
        }
        if !isFocused, textView.isFirstResponder {
            textView.resignFirstResponder()
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: LiveRoleTextView

        init(_ parent: LiveRoleTextView) {
            self.parent = parent
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if !parent.isFocused {
                parent.isFocused = true
            }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            if parent.isFocused {
                parent.isFocused = false
            }
        }

        func textViewDidChange(_ textView: UITextView) {
            let hasText = !(textView.text ?? "").isEmpty
            if parent.hasVisibleText != hasText {
                parent.hasVisibleText = hasText
            }

            // Keep marked text owned by UIKit until the input method commits
            // it. Publishing marked text back into SwiftUI can reset the
            // selection/composition range, but the placeholder must still hide
            // as soon as marked text becomes visible.
            guard textView.markedTextRange == nil else { return }
            if parent.text != textView.text {
                parent.text = textView.text
            }
        }
    }

}

@MainActor
private final class DiscoverConfigStore: ObservableObject {
    @Published private(set) var sections: [DiscoverSection] = DiscoverConfigData.defaultSections

    private static let cacheKey = "bbchat.discover.remoteConfig.v1"
    private let minimumRefreshInterval: TimeInterval = 5 * 60
    private var lastRefreshAttemptDate: Date?

    init() {
        if let cached = Self.cachedConfig() {
            let cachedSections = cached.effectiveSections
            if !cachedSections.isEmpty {
                sections = cachedSections
            }
        }
    }

    func load(force: Bool = false) async {
        if !force, let lastRefreshAttemptDate, Date().timeIntervalSince(lastRefreshAttemptDate) < minimumRefreshInterval {
            return
        }
        lastRefreshAttemptDate = Date()

        do {
            let config = try await APIService.shared.fetchDiscoverConfig()
            let nextSections = config.effectiveSections
            guard !nextSections.isEmpty else { return }
            sections = nextSections
            Self.save(config)
        } catch {
            // Keep bundled defaults or the last valid cached config.
        }
    }

    private static func cachedConfig() -> DiscoverConfigData? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(DiscoverConfigData.self, from: data)
    }

    private static func save(_ config: DiscoverConfigData) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        UserDefaults.standard.set(data, forKey: cacheKey)
    }
}

@MainActor
class MomentsNotificationManager: ObservableObject {
    static let shared = MomentsNotificationManager()
    @Published var unreadCount: Int = 0
    @Published var hasNewMoments: Bool = false

    func fetchFromServer() async {
        do {
            let info = try await APIService.shared.getMomentsUnreadInfo()
            if unreadCount != info.unreadCount { unreadCount = info.unreadCount }
            if hasNewMoments != info.hasNewMoments { hasNewMoments = info.hasNewMoments }
            UnreadBadgeStore.shared.setMomentsUnreadCount(info.unreadCount)
        } catch { }
    }

    func incrementBadge() {
        unreadCount += 1
        UnreadBadgeStore.shared.incrementMomentsUnread()
    }

    func markFeedViewed() {
        hasNewMoments = false
        Task {
            try? await APIService.shared.markMomentsFeedViewed()
        }
    }

    func clearInteractionBadge() {
        unreadCount = 0
        UnreadBadgeStore.shared.setMomentsUnreadCount(0)
        Task {
            try? await APIService.shared.markMomentsNotificationsRead()
        }
    }
}
