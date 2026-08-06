// BWChat/Views/PropBagView.swift
// Extensible container for props owned by the current user.

import SwiftUI

private enum RetiredPropDefinition {
    static let gameEntryCard = "game_entry_card"

    static func contains(_ definitionID: String) -> Bool {
        definitionID == gameEntryCard
    }
}

enum MediaUnlockKind: String, Codable, CaseIterable, Equatable, Sendable {
    case image
    case video

    init(mediaType: String?) {
        self = mediaType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "video"
            ? .video
            : .image
    }

    var definitionID: String {
        switch self {
        case .image: return "media_unlock_card_image"
        case .video: return "media_unlock_card_video"
        }
    }

    var assetName: String {
        switch self {
        case .image: return "prop_image_unlock_card"
        case .video: return "prop_video_unlock_card"
        }
    }

    var localizedCardName: String {
        L10n.tr("prop.mediaUnlockCard.\(rawValue).name")
    }

    var localizedDescription: String {
        L10n.tr("prop.mediaUnlockCard.\(rawValue).description")
    }
}

enum MediaUnlockPaymentMethod: Equatable, Sendable {
    case automatic(MediaUnlockKind)
    case spendableBalance
    case unlockCard(MediaUnlockKind)

    var requestBody: [String: Any] {
        switch self {
        case .automatic(let kind):
            return [
                "payment_method": "auto",
                "prop_definition_id": kind.definitionID
            ]
        case .spendableBalance:
            // Keep the legacy empty-body request compatible with servers that
            // have not rolled out prop-card payments yet.
            return [:]
        case .unlockCard(let kind):
            return [
                "payment_method": "prop_card",
                "prop_definition_id": kind.definitionID
            ]
        }
    }

    var cardKind: MediaUnlockKind? {
        switch self {
        case .automatic(let kind), .unlockCard(let kind):
            return kind
        case .spendableBalance:
            return nil
        }
    }

    var idempotencyScope: String {
        switch self {
        case .automatic(let kind):
            return "auto:\(kind.definitionID)"
        case .spendableBalance:
            return "spendable_balance"
        case .unlockCard(let kind):
            return "prop_card:\(kind.definitionID)"
        }
    }
}

struct PropBagTheme: Codable, Equatable {
    let colors: [String]?
}

struct PropBagMetadata: Codable, Equatable {
    let mediaType: String?
    let durationSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case mediaType = "media_type"
        case durationSeconds = "duration_seconds"
    }

    init(mediaType: String? = nil, durationSeconds: Int? = nil) {
        self.mediaType = mediaType
        self.durationSeconds = durationSeconds
    }
}

struct PropBagItem: Identifiable, Codable, Equatable {
    let inventoryID: String
    let definitionID: String
    let type: String
    let name: String
    let description: String
    let iconURL: String?
    let theme: PropBagTheme?
    var quantity: Int
    let isEquipped: Bool
    let acquiredAt: String?
    let expiresAt: String?
    let availableActions: [String]
    let metadata: PropBagMetadata?

    var id: String { inventoryID }

    enum CodingKeys: String, CodingKey {
        case type, name, description, theme, quantity, metadata
        case inventoryID = "inventory_id"
        case definitionID = "definition_id"
        case iconURL = "icon_url"
        case isEquipped = "is_equipped"
        case acquiredAt = "acquired_at"
        case expiresAt = "expires_at"
        case availableActions = "available_actions"
    }

    init(
        inventoryID: String,
        definitionID: String,
        type: String = "media_unlock_card",
        name: String,
        description: String = "",
        iconURL: String? = nil,
        theme: PropBagTheme? = nil,
        quantity: Int = 1,
        isEquipped: Bool = false,
        acquiredAt: String? = nil,
        expiresAt: String? = nil,
        availableActions: [String] = [],
        metadata: PropBagMetadata? = nil
    ) {
        self.inventoryID = inventoryID
        self.definitionID = definitionID
        self.type = type
        self.name = name
        self.description = description
        self.iconURL = iconURL
        self.theme = theme
        self.quantity = quantity
        self.isEquipped = isEquipped
        self.acquiredAt = acquiredAt
        self.expiresAt = expiresAt
        self.availableActions = availableActions
        self.metadata = metadata
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        inventoryID = try container.decode(String.self, forKey: .inventoryID)
        definitionID = try container.decode(String.self, forKey: .definitionID)
        type = try container.decodeIfPresent(String.self, forKey: .type) ?? "utility"
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? ""
        description = try container.decodeIfPresent(String.self, forKey: .description) ?? ""
        iconURL = try container.decodeIfPresent(String.self, forKey: .iconURL)
        theme = try container.decodeIfPresent(PropBagTheme.self, forKey: .theme)
        quantity = max(try container.decodeIfPresent(Int.self, forKey: .quantity) ?? 0, 0)
        isEquipped = try container.decodeIfPresent(Bool.self, forKey: .isEquipped) ?? false
        acquiredAt = try container.decodeIfPresent(String.self, forKey: .acquiredAt)
        expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
        availableActions = try container.decodeIfPresent([String].self, forKey: .availableActions) ?? []
        metadata = try container.decodeIfPresent(PropBagMetadata.self, forKey: .metadata)
    }

    var mediaUnlockKind: MediaUnlockKind? {
        if definitionID == MediaUnlockKind.image.definitionID { return .image }
        if definitionID == MediaUnlockKind.video.definitionID { return .video }
        guard type == "media_unlock_card", let mediaType = metadata?.mediaType else { return nil }
        return MediaUnlockKind(mediaType: mediaType)
    }

    var canConsumeForMediaUnlock: Bool {
        quantity > 0 && availableActions.contains("consume_for_media_unlock")
    }

    var liveExperienceCardKind: LiveExperienceCardKind? {
        if let kind = LiveExperienceCardKind(definitionID: definitionID) {
            return kind
        }
        guard type == "live_experience_card",
              let durationSeconds = metadata?.durationSeconds else { return nil }
        return LiveExperienceCardKind(durationSeconds: durationSeconds)
    }

    var canConsumeForLiveExperience: Bool {
        liveExperienceCardKind != nil
            && quantity > 0
            && availableActions.contains("consume_for_live_experience")
    }

    var resolvedName: String {
        guard name.isBlank else { return name }
        if let kind = liveExperienceCardKind { return kind.localizedName }
        return mediaUnlockKind?.localizedCardName ?? L10n.tr("propBag.item.unknown")
    }

    var resolvedDescription: String {
        guard description.isBlank else { return description }
        if let kind = liveExperienceCardKind { return kind.localizedDescription }
        return mediaUnlockKind?.localizedDescription ?? ""
    }

    var bundledAssetName: String? {
        if let kind = liveExperienceCardKind { return kind.assetName }
        return mediaUnlockKind?.assetName
    }

    var expirationDate: Date? {
        guard let expiresAt else { return nil }
        return Self.iso8601WithFractional.date(from: expiresAt)
            ?? Self.iso8601.date(from: expiresAt)
    }

    private static let iso8601WithFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso8601 = ISO8601DateFormatter()
}

struct PropBagSummary: Codable, Equatable {
    let totalQuantity: Int
    let equippedCount: Int
    let expiringCount: Int

    enum CodingKeys: String, CodingKey {
        case totalQuantity = "total_quantity"
        case equippedCount = "equipped_count"
        case expiringCount = "expiring_count"
    }

    static let empty = PropBagSummary(totalQuantity: 0, equippedCount: 0, expiringCount: 0)
}

struct PropBagPage: Decodable, Equatable {
    let summary: PropBagSummary
    let items: [PropBagItem]
    let nextCursor: String?
    let serverTime: String?

    enum CodingKeys: String, CodingKey {
        case summary, items
        case nextCursor = "next_cursor"
        case serverTime = "server_time"
    }
}

struct PropConsumptionResult: Decodable, Equatable, Sendable {
    let inventoryID: String?
    let definitionID: String
    let remainingQuantity: Int

    enum CodingKeys: String, CodingKey {
        case inventoryID = "inventory_id"
        case definitionID = "definition_id"
        case remainingQuantity = "remaining_quantity"
    }
}

@MainActor
final class PropInventoryStore: ObservableObject {
    static let shared = PropInventoryStore()

    @Published private(set) var items: [PropBagItem]
    @Published private(set) var summary: PropBagSummary
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private var lastLoadedAt: Date?

    init(items: [PropBagItem] = []) {
        let supportedItems = Self.supportedItems(from: items)
        self.items = supportedItems
        self.summary = Self.summary(for: supportedItems)
    }

    func load(forceRefresh: Bool = false) async {
        if !forceRefresh,
           let lastLoadedAt,
           Date().timeIntervalSince(lastLoadedAt) < 60 {
            return
        }
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let page = try await APIService.shared.getPropBag()
            guard !Task.isCancelled else { return }
            items = Self.supportedItems(from: page.items)
            summary = Self.summary(for: items)
            errorMessage = nil
            lastLoadedAt = Date()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func quantity(for kind: MediaUnlockKind) -> Int {
        items
            .filter { $0.mediaUnlockKind == kind && $0.canConsumeForMediaUnlock }
            .reduce(0) { $0 + $1.quantity }
    }

    func quantity(for kind: LiveExperienceCardKind) -> Int {
        items
            .filter { $0.liveExperienceCardKind == kind && $0.canConsumeForLiveExperience }
            .reduce(0) { $0 + $1.quantity }
    }

    var availableLiveExperienceCards: [LiveExperienceCardKind] {
        LiveExperienceCardKind.allCases.filter { quantity(for: $0) > 0 }
    }

    func applyConsumption(_ consumption: PropConsumptionResult, fallbackKind: MediaUnlockKind) {
        applyConsumption(
            consumption,
            fallbackDefinitionID: fallbackKind.definitionID,
            requiredAction: "consume_for_media_unlock"
        )
    }

    func applyLiveExperienceReservation(
        _ reservation: PropConsumptionResult?,
        fallbackKind: LiveExperienceCardKind
    ) {
        applyConsumption(
            reservation,
            fallbackDefinitionID: fallbackKind.definitionID,
            requiredAction: "consume_for_live_experience"
        )
    }

    private func applyConsumption(
        _ consumption: PropConsumptionResult?,
        fallbackDefinitionID: String,
        requiredAction: String
    ) {
        let definitionID = consumption?.definitionID ?? fallbackDefinitionID
        if let inventoryID = consumption?.inventoryID,
           let index = items.firstIndex(where: { $0.inventoryID == inventoryID }) {
            items[index].quantity = max(consumption?.remainingQuantity ?? (items[index].quantity - 1), 0)
        } else if let index = items.firstIndex(where: {
            $0.definitionID == definitionID
                && $0.quantity > 0
                && $0.availableActions.contains(requiredAction)
        }) {
            items[index].quantity = max(items[index].quantity - 1, 0)
        }
        items.removeAll { $0.quantity <= 0 }
        summary = Self.summary(for: items)
        lastLoadedAt = Date()
    }

    private static func summary(for items: [PropBagItem]) -> PropBagSummary {
        PropBagSummary(
            totalQuantity: items.reduce(0) { $0 + max($1.quantity, 0) },
            equippedCount: items.filter(\.isEquipped).count,
            expiringCount: items.filter {
                guard let date = $0.expirationDate else { return false }
                let interval = date.timeIntervalSinceNow
                return interval >= 0 && interval <= 7 * 24 * 60 * 60
            }.count
        )
    }

    private static func supportedItems(from items: [PropBagItem]) -> [PropBagItem] {
        items.filter {
            $0.quantity > 0 && !RetiredPropDefinition.contains($0.definitionID)
        }
    }
}

struct PropBagView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var store: PropInventoryStore
    @ObservedObject private var walletStore: WalletStore

    private var isReviewScreenshotMode: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-propBagReviewScreenshot")
        #else
        false
        #endif
    }

    init(store: PropInventoryStore, walletStore: WalletStore) {
        self.store = store
        self.walletStore = walletStore
    }

    @MainActor
    init(store: PropInventoryStore) {
        self.init(store: store, walletStore: .shared)
    }

    @MainActor
    init() {
        self.init(store: .shared, walletStore: .shared)
    }

    private var showsActivityCatFood: Bool {
        walletStore.isActivityCatFoodEnabled || walletStore.activityCatFoodBalance != nil
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 16) {
                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 32)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("propBag.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task {
            guard !isReviewScreenshotMode else { return }
            async let props: Void = store.load()
            async let balance: Void = walletStore.refreshBalanceFromServer()
            _ = await (props, balance)
        }
        .refreshable {
            async let props: Void = store.load(forceRefresh: true)
            async let balance: Void = walletStore.refreshBalanceFromServer(forceRefresh: true)
            _ = await (props, balance)
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.isLoading && store.items.isEmpty && !showsActivityCatFood {
            ProgressView()
                .frame(maxWidth: .infinity)
                .frame(minHeight: 280)
        } else if let errorMessage = store.errorMessage,
                  store.items.isEmpty,
                  !showsActivityCatFood {
            PropBagLoadError(message: errorMessage) {
                Task { await store.load(forceRefresh: true) }
            }
        } else if store.items.isEmpty && !showsActivityCatFood {
            PropBagEmptyState()
        } else {
            VStack(spacing: 16) {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10)
                    ],
                    spacing: 10
                ) {
                    if showsActivityCatFood {
                        ActivityCatFoodBagItemCard(
                            balance: walletStore.activityCatFoodBalanceValue,
                            isReadOnly: !walletStore.isActivityCatFoodEnabled,
                            errorMessage: walletStore.balanceLoadError
                        ) {
                            navigator.push(ActivityCatFoodDetailView(walletStore: walletStore))
                        } retry: {
                            Task { await walletStore.refreshBalanceFromServer(forceRefresh: true) }
                        }
                    }

                    if !isReviewScreenshotMode {
                        ForEach(store.items) { item in
                            PropBagItemCard(item: item)
                        }
                    }
                }

                if !isReviewScreenshotMode,
                   store.items.isEmpty,
                   store.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 120)
                } else if !isReviewScreenshotMode,
                          store.items.isEmpty,
                          let errorMessage = store.errorMessage {
                    PropBagLoadError(message: errorMessage) {
                        Task { await store.load(forceRefresh: true) }
                    }
                }
            }
        }
    }
}

private struct ActivityCatFoodBagItemCard: View {
    let balance: Int?
    let isReadOnly: Bool
    let errorMessage: String?
    let openDetails: () -> Void
    let retry: () -> Void

    var body: some View {
        PropBagGridItemCard(
            title: L10n.tr("activityCatFood.title"),
            quantityText: balance.map(String.init) ?? "…",
            accessibilityHint: accessibilityHint,
            action: handleTap
        ) {
            Image("activity_cat_food_icon")
                .resizable()
                .scaledToFit()
                .padding(2)
                .frame(width: 92, height: 92)
        }
        .disabled(isReadOnly)
    }

    private var accessibilityHint: String {
        if isReadOnly {
            return L10n.tr("activityCatFood.readOnly")
        }
        return errorMessage ?? L10n.tr("activityCatFood.card.subtitle")
    }

    private func handleTap() {
        if balance == nil, errorMessage != nil {
            retry()
        } else {
            openDetails()
        }
    }
}

struct ActivityCatFoodDetailView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var walletStore: WalletStore

    init(walletStore: WalletStore) {
        self.walletStore = walletStore
    }

    @MainActor
    init() {
        self.init(walletStore: .shared)
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 14) {
                balanceHeader
                rulesCard
                transactionContent
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 32)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("activityCatFood.details.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task {
            async let balance: Void = walletStore.refreshBalanceFromServer()
            async let transactions: Void = walletStore.loadActivityCatFoodTransactions(reset: true)
            _ = await (balance, transactions)
        }
        .refreshable {
            async let balance: Void = walletStore.refreshBalanceFromServer(forceRefresh: true)
            async let transactions: Void = walletStore.loadActivityCatFoodTransactions(reset: true)
            _ = await (balance, transactions)
        }
    }

    private var balanceHeader: some View {
        HStack(spacing: 16) {
            Image("activity_cat_food_icon")
                .resizable()
                .scaledToFit()
                .frame(width: 92, height: 92)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(L10n.tr("activityCatFood.balance"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white.opacity(0.78))
                Text(walletStore.activityCatFoodBalanceValue.map(String.init) ?? L10n.tr("common.loading"))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .monospacedDigit()
                Text(L10n.tr("activityCatFood.rate"))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.78))
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [Color(hex: "667EEA"), Color(hex: "8C7CF3")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var rulesCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.tr("activityCatFood.rules.title"))
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(AppColors.primaryText)

            ruleRow("sparkles", text: L10n.tr("activityCatFood.rules.officialOnly"))
            ruleRow("equal.circle.fill", text: L10n.tr("activityCatFood.rules.equalValue"))
            ruleRow("arrow.down.circle.fill", text: L10n.tr("activityCatFood.rules.priority"))
            ruleRow("gamecontroller.fill", text: L10n.tr("activityCatFood.rules.gameExclusion"))
            ruleRow("nosign", text: L10n.tr("activityCatFood.rules.restrictions"))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(AppColors.separator, lineWidth: 1)
        )
    }

    private func ruleRow(_ systemImage: String, text: String) -> some View {
        Label {
            Text(text)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
        } icon: {
            Image(systemName: systemImage)
                .foregroundColor(Color(hex: "7667E8"))
        }
    }

    @ViewBuilder
    private var transactionContent: some View {
        if walletStore.isLoadingActivityCatFoodTransactions,
           walletStore.activityCatFoodTransactions.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity)
                .frame(minHeight: 220)
        } else if let error = walletStore.activityCatFoodTransactionLoadError,
                  walletStore.activityCatFoodTransactions.isEmpty {
            PropBagLoadError(message: error) {
                Task { await walletStore.loadActivityCatFoodTransactions(reset: true) }
            }
        } else if walletStore.activityCatFoodTransactions.isEmpty {
            VStack(spacing: 12) {
                Image("activity_cat_food_icon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)
                Text(L10n.tr("activityCatFood.transactions.empty"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AppColors.secondaryText)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 220)
            .background(AppColors.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text(L10n.tr("activityCatFood.transactions.title"))
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(AppColors.primaryText)

                ForEach(walletStore.activityCatFoodTransactions) { transaction in
                    ActivityCatFoodTransactionRow(transaction: transaction)
                        .onAppear {
                            guard transaction.id == walletStore.activityCatFoodTransactions.last?.id,
                                  walletStore.activityCatFoodNextCursor != nil else { return }
                            Task { await walletStore.loadActivityCatFoodTransactions(reset: false) }
                        }
                }

                if walletStore.isLoadingActivityCatFoodTransactions {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
        }
    }
}

private struct ActivityCatFoodTransactionRow: View {
    let transaction: ActivityCatFoodTransaction

    var body: some View {
        HStack(spacing: 12) {
            Image("activity_cat_food_icon")
                .resizable()
                .scaledToFit()
                .frame(width: 38, height: 38)
                .padding(5)
                .background(Color(hex: "EEEAFE"), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(transaction.displayTitle)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                if let createdAt = transaction.createdAt, !createdAt.isBlank {
                    Text(createdAt)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(AppColors.tertiaryText)
                        .lineLimit(1)
                }
                if let source = transaction.displaySource {
                    Text(source)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(AppColors.tertiaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                Text(transaction.signedAmountText)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundColor(transaction.delta >= 0 ? AppColors.online : AppColors.primaryText)
                    .monospacedDigit()
                Text(L10n.tr("activityCatFood.balanceAfter", transaction.balanceAfter))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(AppColors.tertiaryText)
            }
        }
        .padding(13)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(AppColors.separator, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

struct LiveExperienceCardArtwork: View {
    let kind: LiveExperienceCardKind

    var body: some View {
        Image(kind.assetName)
            .resizable()
            .scaledToFit()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(kind.localizedName)
    }
}

private struct PropBagGridItemCard<Artwork: View>: View {
    let title: String
    let quantityText: String
    let accessibilityHint: String
    let action: () -> Void
    let artwork: Artwork

    init(
        title: String,
        quantityText: String,
        accessibilityHint: String,
        action: @escaping () -> Void,
        @ViewBuilder artwork: () -> Artwork
    ) {
        self.title = title
        self.quantityText = quantityText
        self.accessibilityHint = accessibilityHint
        self.action = action
        self.artwork = artwork()
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                artwork
                    .frame(width: 92, height: 92)

                VStack(spacing: 4) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.76)
                        .frame(maxWidth: .infinity)

                    Text("×\(quantityText)")
                        .font(.system(size: 16, weight: .heavy, design: .rounded))
                        .foregroundColor(AppColors.primaryText)
                        .monospacedDigit()
                        .padding(.horizontal, 7)
                        .frame(height: 24)
                        .background(AppColors.cardBackground.opacity(0.92), in: Capsule())
                        .overlay {
                            Capsule()
                                .strokeBorder(AppColors.separator.opacity(0.7), lineWidth: 1)
                        }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 170)
            .padding(.horizontal, 8)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .background {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(AppColors.cardBackground)
                    .shadow(color: Color.black.opacity(0.035), radius: 3, x: 0, y: 2)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(AppColors.separator.opacity(0.62), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), ×\(quantityText)")
        .accessibilityHint(accessibilityHint)
    }
}

private struct PropBagItemCard: View {
    let item: PropBagItem
    @State private var showsUsageRules = false

    var body: some View {
        PropBagGridItemCard(
            title: item.resolvedName,
            quantityText: String(item.quantity),
            accessibilityHint: usageRuleText
        ) {
            showsUsageRules = true
        } artwork: {
            itemArtwork
        }
        .popover(
            isPresented: $showsUsageRules,
            attachmentAnchor: .rect(.bounds),
            arrowEdge: .top
        ) {
            if #available(iOS 16.4, *) {
                usageRulesPopover
                    .presentationCompactAdaptation(.popover)
            } else {
                usageRulesPopover
            }
        }
    }

    private var usageRulesPopover: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(AppColors.accent)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
                Text(item.resolvedName)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(AppColors.primaryText)

                Text(usageRuleText)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(width: 230, alignment: .leading)
        .padding(16)
    }

    private var usageRuleText: String {
        let rule = item.resolvedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return rule.isEmpty ? item.resolvedName : rule
    }

    @ViewBuilder
    private var itemArtwork: some View {
        if let kind = item.liveExperienceCardKind {
            LiveExperienceCardArtwork(kind: kind)
                .padding(2)
        } else if let assetName = item.bundledAssetName {
            Image(assetName)
                .resizable()
                .scaledToFit()
                .padding(2)
        } else if let iconURL = item.iconURL,
                  let url = URL(string: iconURL) {
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFit()
                } else {
                    fallbackArtwork
                }
            }
            .padding(6)
        } else {
            fallbackArtwork
        }
    }

    private var fallbackArtwork: some View {
        Image(systemName: fallbackSystemImage)
            .font(.system(size: 40, weight: .semibold))
            .foregroundColor(AppColors.accent)
    }

    private var fallbackSystemImage: String {
        if item.liveExperienceCardKind != nil { return "clock.badge.checkmark.fill" }
        return item.mediaUnlockKind == .video ? "play.rectangle.fill" : "photo.fill"
    }
}

private struct PropBagLoadError: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 34))
                .foregroundColor(AppColors.warningColor)

            Text(message)
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)

            Button(L10n.tr("common.retry"), action: retry)
                .buttonStyle(.borderedProminent)
                .tint(AppColors.accent)
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity)
        .frame(minHeight: 280)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct PropBagEmptyState: View {
    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(AppColors.accentLight)
                    .frame(width: 88, height: 88)

                Image(systemName: "shippingbox")
                    .font(.system(size: 38, weight: .medium))
                    .foregroundColor(AppColors.accent)
            }

            VStack(spacing: 6) {
                Text(L10n.tr("propBag.empty.title"))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(AppColors.primaryText)

                Text(L10n.tr("propBag.empty.message"))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity)
        .frame(minHeight: 280)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(AppColors.separator, lineWidth: 1)
        )
    }

}

private struct PropBagView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            NavigationStack {
                PropBagView()
            }
            .previewDisplayName("Empty")

            NavigationStack {
                PropBagView(store: PropInventoryStore(items: previewItems))
            }
            .previewDisplayName("Items")
        }
        .environmentObject(UIKitNavigator())
    }

    private static var previewItems: [PropBagItem] {
        [
            PropBagItem(
                inventoryID: "image-card",
                definitionID: MediaUnlockKind.image.definitionID,
                name: MediaUnlockKind.image.localizedCardName,
                description: MediaUnlockKind.image.localizedDescription,
                theme: PropBagTheme(colors: ["7B68EE", "78D8F7"]),
                quantity: 3,
                availableActions: ["consume_for_media_unlock"],
                metadata: PropBagMetadata(mediaType: "image")
            ),
            PropBagItem(
                inventoryID: "video-card",
                definitionID: MediaUnlockKind.video.definitionID,
                name: MediaUnlockKind.video.localizedCardName,
                description: MediaUnlockKind.video.localizedDescription,
                theme: PropBagTheme(colors: ["5B21B6", "FF4F91"]),
                quantity: 1,
                availableActions: ["consume_for_media_unlock"],
                metadata: PropBagMetadata(mediaType: "video")
            ),
            PropBagItem(
                inventoryID: "live-experience-10m",
                definitionID: LiveExperienceCardKind.tenMinutes.definitionID,
                type: "live_experience_card",
                name: LiveExperienceCardKind.tenMinutes.localizedName,
                description: LiveExperienceCardKind.tenMinutes.localizedDescription,
                theme: PropBagTheme(colors: ["7C5CFF", "FF70C5"]),
                quantity: 2,
                availableActions: ["consume_for_live_experience"],
                metadata: PropBagMetadata(durationSeconds: 600)
            )
        ]
    }
}
