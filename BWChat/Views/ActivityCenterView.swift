import SwiftUI
import UIKit

private enum ActivityMotion {
    static let tap = Animation.easeOut(duration: 0.08)
    static let stateChange = Animation.easeInOut(duration: 0.24)
    static let overlayIn = Animation.spring(response: 0.38, dampingFraction: 0.86)
    static let overlayOut = Animation.easeInOut(duration: 0.2)
    static let rewardPop = Animation.spring(response: 0.34, dampingFraction: 0.58)
    static let rewardSettle = Animation.spring(response: 0.42, dampingFraction: 0.78)
}

struct ActivityCenterView: View {
    private enum Tab: String, CaseIterable, Identifiable {
        case benefits
        case wheel
        var id: String { rawValue }
        var title: String {
            switch self {
            case .benefits: return L10n.tr("activityCenter.tab.benefits")
            case .wheel: return L10n.tr("activityCenter.tab.wheel")
            }
        }
    }

    fileprivate enum Sheet: Identifiable {
        case redeem
        case share(ActivityInviteShareSession)

        var id: String {
            switch self {
            case .redeem: return "redeem"
            case .share(let session): return "share-\(session.id)"
            }
        }
    }

    private enum Overlay: Identifiable {
        case phone
        case matches
        case wheelResult(ActivityWheelSpinResult)

        var id: String {
            switch self {
            case .phone: return "phone"
            case .matches: return "matches"
            case .wheelResult(let result): return "wheel-result-\(result.id)"
            }
        }
    }

    @StateObject private var store: ActivityCenterStore
    @ObservedObject private var authManager = AuthManager.shared
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedTab: Tab = .benefits
    @State private var sheet: Sheet?
    @State private var overlay: Overlay?

    @MainActor
    init() {
        _store = StateObject(wrappedValue: ActivityCenterStore())
        _overlay = State(initialValue: nil)
    }

    @MainActor
    init(
        store: ActivityCenterStore,
        initialWheelResult: ActivityWheelSpinResult? = nil,
        initialShowsMatches: Bool = false,
        initialShowsPhoneBinding: Bool = false,
        initialShowsWheel: Bool = false
    ) {
        _store = StateObject(wrappedValue: store)
        _selectedTab = State(initialValue: initialShowsWheel ? .wheel : .benefits)
        if let initialWheelResult {
            _overlay = State(initialValue: .wheelResult(initialWheelResult))
        } else if initialShowsMatches {
            _overlay = State(initialValue: .matches)
        } else if initialShowsPhoneBinding {
            _overlay = State(initialValue: .phone)
        } else {
            _overlay = State(initialValue: nil)
        }
    }

    var body: some View {
        ZStack {
            content
                .background(AppColors.secondaryBackground.ignoresSafeArea())
                .accessibilityHidden(overlay != nil)

            presentedOverlay

            if let celebration = store.rewardCelebration {
                ActivityRewardCelebrationOverlay(celebration: celebration) {
                    store.dismissRewardCelebration(id: celebration.id)
                }
                .id(celebration.id)
                .zIndex(20)
            }
        }
        .tint(AppColors.accent)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.clear, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .principal) {
                tabPicker
            }
        }
        .task(id: authManager.currentUser?.userID ?? "anonymous") {
            await store.load(force: true)
            await redeemPendingDeepLink()
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task { await store.load(force: true) }
        }
        .onReceive(ActivityInviteRouteStore.shared.$pendingToken.compactMap { $0 }) { _ in
            Task { await redeemPendingDeepLink() }
        }
        .sheet(item: $sheet) { item in sheetContent(item) }
        .alert(
            L10n.tr("common.operationFailed"),
            isPresented: Binding(
                get: { store.errorMessage != nil },
                set: { if !$0 { store.errorMessage = nil } }
            )
        ) {
            Button(L10n.tr("common.ok"), role: .cancel) { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }

    private var tabPicker: some View {
        SystemSegmentedTabs(
            items: Tab.allCases,
            selection: animatedTabSelection,
            title: { $0.title },
            accessibilityIdentifier: "activityCenter.top.tabs",
            fontWeight: .semibold
        )
        .frame(width: 228)
        .accessibilityElement(children: .contain)
    }

    private var animatedTabSelection: Binding<Tab> {
        Binding(
            get: { selectedTab },
            set: { nextTab in
                guard nextTab != selectedTab else { return }
                if reduceMotion {
                    selectedTab = nextTab
                } else {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        selectedTab = nextTab
                    }
                }
            }
        )
    }

    @ViewBuilder
    private var content: some View {
        if store.isLoading, store.snapshot == nil {
            VStack(spacing: 14) {
                ProgressView()
                Text(L10n.tr("common.loading"))
                    .foregroundStyle(AppColors.secondaryText)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let snapshot = store.snapshot {
            TabView(selection: $selectedTab) {
                ActivityBenefitsView(
                    store: store,
                    snapshot: snapshot,
                    sheet: $sheet,
                    onShowMatches: presentMatches,
                    onShowPhoneBinding: presentPhoneBinding
                )
                    .refreshable { await store.load(force: true) }
                    .tag(Tab.benefits)

                ActivityWheelView(store: store, snapshot: snapshot) { result in
                    presentWheelResult(result)
                }
                    .refreshable { await store.load(force: true) }
                    .tag(Tab.wheel)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .safeAreaInset(edge: .top, spacing: 0) {
                if store.isShowingCachedData {
                    Label(L10n.tr("activityCenter.cached"), systemImage: "wifi.slash")
                        .font(.caption)
                        .foregroundStyle(AppColors.secondaryText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(.thinMaterial)
                }
            }
        } else {
            ActivityUnavailableView(
                title: L10n.tr("activityCenter.loadFailed"),
                systemImage: "giftcard",
                message: store.errorMessage ?? L10n.tr("api.networkUnavailable")
            )
            .overlay(alignment: .bottom) {
                Button(L10n.tr("common.retry")) { Task { await store.load(force: true) } }
                    .buttonStyle(.borderedProminent)
                    .tint(AppColors.accent)
                    .padding(.bottom, 40)
            }
        }
    }

    @ViewBuilder
    private func sheetContent(_ item: Sheet) -> some View {
        switch item {
        case .redeem:
            ActivityInviteRedeemSheet(
                store: store,
                operationStatus: store.operationStatus(for: .redeem)
            )
        case .share(let session):
            ActivityShareSheet(session: session) { completed in
                sheet = nil
                guard completed else { return }
                Task { await store.completeShare(sessionID: session.id) }
            }
        }
    }

    @ViewBuilder
    private var presentedOverlay: some View {
        if let overlay {
            Group {
                switch overlay {
                case .phone:
                    ActivityPhoneBindingOverlay(store: store, dismiss: dismissOverlay)
                case .matches:
                    ActivityMatchesOverlay(store: store, dismiss: dismissOverlay)
                case .wheelResult(let result):
                    ActivityWheelResultOverlay(result: result, dismiss: dismissOverlay)
                }
            }
            .transition(.opacity.combined(with: .scale(scale: 0.98)))
            .zIndex(10)
        }
    }

    private func presentWheelResult(_ result: ActivityWheelSpinResult) {
        if reduceMotion {
            overlay = .wheelResult(result)
        } else {
            withAnimation(ActivityMotion.overlayIn) {
                overlay = .wheelResult(result)
            }
        }
    }

    private func presentMatches() {
        if reduceMotion {
            overlay = .matches
        } else {
            withAnimation(ActivityMotion.overlayIn) {
                overlay = .matches
            }
        }
    }

    private func presentPhoneBinding() {
        if reduceMotion {
            overlay = .phone
        } else {
            withAnimation(ActivityMotion.overlayIn) {
                overlay = .phone
            }
        }
    }

    private func dismissOverlay() {
        if reduceMotion {
            overlay = nil
        } else {
            withAnimation(ActivityMotion.overlayOut) {
                overlay = nil
            }
        }
    }

    private func redeemPendingDeepLink() async {
        guard let token = ActivityInviteRouteStore.shared.consumePendingToken() else { return }
        _ = await store.redeemInvite(token)
    }
}

private struct ActivityBenefitsView: View {
    let store: ActivityCenterStore
    let snapshot: ActivityCenterSnapshot
    @Binding var sheet: ActivityCenterView.Sheet?
    let onShowMatches: () -> Void
    let onShowPhoneBinding: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if snapshot.configVersion.isEmpty {
                    ActivityCard {
                        ActivityUnavailableView(
                            title: L10n.tr("activityCenter.tab.benefits"),
                            systemImage: "calendar.badge.exclamationmark",
                            message: L10n.tr("activityCenter.error.inactiveConfig")
                        )
                    }
                } else {
                    if !snapshot.checkIn.days.isEmpty { checkInCard }
                    if !snapshot.mealRewards.isEmpty { mealCard }
                    if snapshot.task(.contactSync) != nil || snapshot.task(.inviteShare) != nil {
                        taskCard
                    }
                    if !snapshot.invitation.inviteCode.isEmpty || snapshot.task(.validInvite) != nil {
                        inviteCard
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
    }

    private var checkInCard: some View {
        ActivityCard {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(L10n.tr("activityCenter.checkIn.title"))
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(AppColors.primaryText)
                        Spacer(minLength: 8)
                        ActivityCheckInProgressBadge(
                            claimedDays: snapshot.checkIn.claimedDays,
                            totalDays: max(snapshot.checkIn.days.count, 7)
                        )
                    }
                    Text(L10n.tr("activityCenter.checkIn.subtitle"))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AppColors.secondaryText)
                }

                ActivityCheckInGrid(days: snapshot.checkIn.days)

                ActivityOperationPrimaryButton(
                    title: snapshot.checkIn.completed
                        ? L10n.tr("activityCenter.completed")
                        : L10n.tr("activityCenter.checkIn.claim"),
                    operationStatus: store.operationStatus(for: .checkIn),
                    isDisabled: !snapshot.checkIn.canClaim || snapshot.checkIn.completed
                ) {
                    Task { await store.claimCheckIn() }
                }
            }
        }
    }

    private var mealCard: some View {
        ActivityCard {
            VStack(alignment: .leading, spacing: 12) {
                ActivitySectionTitle(
                    title: L10n.tr("activityCenter.meals.title"),
                    subtitle: L10n.tr("activityCenter.meals.subtitle")
                )
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let serverNow = store.serverNow(at: context.date)
                    let orderedMeals = ActivityMealSchedule.ordered(
                        snapshot.mealRewards,
                        at: serverNow,
                        timezoneID: snapshot.businessTimezone
                    )
                    VStack(spacing: 0) {
                        ForEach(Array(orderedMeals.enumerated()), id: \.element.id) { index, meal in
                            ActivityMealRow(
                                store: store,
                                meal: meal,
                                serverNow: serverNow,
                                operationStatus: store.operationStatus(for: .meal(meal.id))
                            )
                            if index < orderedMeals.count - 1 { Divider() }
                        }
                    }
                }
            }
        }
    }

    private var taskCard: some View {
        ActivityCard {
            VStack(alignment: .leading, spacing: 0) {
                ActivitySectionTitle(
                    title: L10n.tr("activityCenter.tasks.title"),
                    subtitle: nil
                )
                .padding(.bottom, 4)
                if let task = snapshot.task(.contactSync) {
                    ActivityTaskRow(
                        icon: "person.crop.circle.badge.checkmark",
                        title: L10n.tr("activityCenter.contacts.title"),
                        subtitle: snapshot.phoneBinding.isVerified
                            ? L10n.tr("activityCenter.contacts.subtitle")
                            : L10n.tr("activityCenter.phone.required"),
                        task: task,
                        operationStatus: store.operationStatus(for: .contacts)
                    ) {
                        if snapshot.phoneBinding.isVerified {
                            Task {
                                if await store.discoverContacts() { onShowMatches() }
                            }
                        } else {
                            onShowPhoneBinding()
                        }
                    }
                    Divider().padding(.leading, 50)
                }
                if let task = snapshot.task(.inviteShare) {
                    ActivityTaskRow(
                        icon: "square.and.arrow.up.fill",
                        title: L10n.tr("activityCenter.share.title"),
                        subtitle: task.dailyLimit.map {
                            L10n.tr("activityCenter.share.progress", task.creditedCount, $0)
                        } ?? L10n.tr("activityCenter.share.subtitle"),
                        task: task,
                        operationStatus: store.operationStatus(for: .share)
                    ) {
                        Task {
                            if let session = await store.createShareSession() {
                                sheet = .share(session)
                            }
                        }
                    }
                }
            }
        }
    }

    private var inviteCard: some View {
        ActivityCard {
            VStack(alignment: .leading, spacing: 12) {
                ActivitySectionTitle(
                    title: L10n.tr("activityCenter.invite.title"),
                    subtitle: L10n.tr("activityCenter.invite.subtitle")
                )
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(L10n.tr("activityCenter.invite.code"))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(AppColors.secondaryText)
                        Text(snapshot.invitation.inviteCode)
                            .font(.system(size: 22, weight: .bold, design: .rounded).monospaced())
                            .foregroundStyle(AppColors.primaryText)
                            .textSelection(.enabled)
                    }
                    Spacer()
                    if let task = snapshot.task(.validInvite) {
                        ActivityRewardBadge(amount: task.rewardActivityCatFood)
                    }
                }
                .padding(13)
                .background(AppColors.secondaryBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                HStack(spacing: 10) {
                    Button(L10n.tr("activityCenter.invite.redeem")) {
                        ActivityTapFeedback.play()
                        sheet = .redeem
                    }
                        .buttonStyle(.bordered)
                        .tint(AppColors.accent)
                        .controlSize(.regular)
                        .disabled(!snapshot.invitation.canRedeem)
                    Spacer()
                    Text(L10n.tr(
                        "activityCenter.invite.stats",
                        snapshot.invitation.pendingInvites,
                        snapshot.invitation.creditedInvites
                    ))
                    .font(.caption)
                    .foregroundStyle(AppColors.secondaryText)
                }
            }
        }
    }
}

private struct ActivityCheckInProgressBadge: View {
    let claimedDays: Int
    let totalDays: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scale = 1.0

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "calendar.badge.checkmark")
            Text("\(claimedDays)/\(totalDays)")
                .monospacedDigit()
        }
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(AppColors.accent)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(AppColors.accentLight, in: Capsule())
        .scaleEffect(scale)
        .onChange(of: claimedDays) { _ in
            guard !reduceMotion else { return }
            withAnimation(ActivityMotion.rewardPop) { scale = 1.1 }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 160_000_000)
                guard !Task.isCancelled else { return }
                withAnimation(ActivityMotion.rewardSettle) { scale = 1 }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ActivityCheckInGrid: View {
    let days: [ActivityCheckInDay]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var orderedDays: [ActivityCheckInDay] {
        days.sorted { $0.day < $1.day }
    }

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 118), spacing: 8)],
                spacing: 8
            ) {
                ForEach(orderedDays) { day in
                    ActivityCheckInDayCell(day: day, isFinal: day.id == orderedDays.last?.id)
                }
            }
        } else {
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                GridRow {
                    ForEach(Array(orderedDays.prefix(4))) { day in
                        ActivityCheckInDayCell(day: day)
                    }
                }
                if orderedDays.count > 4 {
                    GridRow {
                        ForEach(Array(orderedDays.dropFirst(4).prefix(2))) { day in
                            ActivityCheckInDayCell(day: day)
                        }
                        if let finalDay = orderedDays.dropFirst(6).first {
                            ActivityCheckInDayCell(day: finalDay, isFinal: true)
                                .gridCellColumns(2)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

private struct ActivityCheckInDayCell: View {
    let day: ActivityCheckInDay
    var isFinal = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var rewardScale = 1.0
    @State private var celebrationScale = 0.72
    @State private var celebrationOpacity = 0.0

    private var isClaimed: Bool {
        day.status == .claimed || day.status == .completed
    }

    private var isClaimable: Bool { day.status.canClaim }

    private var labelColor: Color {
        isClaimable ? .white : AppColors.primaryText
    }

    var body: some View {
        Group {
            if isFinal {
                HStack(spacing: 9) {
                    Image("activity_reward_paw")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 38, height: 38)
                        .scaleEffect(rewardScale)
                        .opacity(day.status == .locked ? 0.56 : 1)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L10n.tr("activityCenter.day", day.day))
                            .font(.system(size: 11, weight: .semibold))
                        Text("+\(day.rewardActivityCatFood)")
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                            .allowsTightening(true)
                            .layoutPriority(1)
                    }
                    Spacer(minLength: 4)
                }
                .padding(.leading, 12)
                .padding(.trailing, 34)
                .overlay(alignment: .trailing) {
                    Image(systemName: isClaimed ? "checkmark.circle.fill" : "sparkles")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(isClaimable ? .white.opacity(0.9) : AppColors.iconYellowDeep)
                        .padding(.trailing, 12)
                        .accessibilityHidden(true)
                }
            } else {
                VStack(spacing: 4) {
                    Text(L10n.tr("activityCenter.day", day.day))
                        .font(.system(size: 10, weight: .semibold))
                    Image("activity_reward_paw")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 30, height: 30)
                        .scaleEffect(rewardScale)
                        .opacity(day.status == .locked ? 0.48 : 1)
                        .accessibilityHidden(true)
                    Text("+\(day.rewardActivityCatFood)")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                        .allowsTightening(true)
                }
            }
        }
        .foregroundStyle(labelColor)
        .frame(maxWidth: .infinity, minHeight: 88)
        .background { cellBackground }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(cellBorderColor, lineWidth: isClaimable ? 0 : 1)
        }
        .overlay(alignment: .topTrailing) {
            if isClaimed && !isFinal {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(AppColors.accent)
                    .padding(7)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .overlay {
            Image(systemName: "sparkles")
                .font(.system(size: isFinal ? 30 : 24, weight: .bold))
                .foregroundStyle(AppColors.iconYellowDeep)
                .scaleEffect(celebrationScale)
                .opacity(celebrationOpacity)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .shadow(color: isClaimable ? AppColors.accent.opacity(0.2) : .clear, radius: 8, y: 4)
        .animation(reduceMotion ? nil : ActivityMotion.stateChange, value: day.status)
        .onChange(of: isClaimed) { claimed in
            guard claimed else { return }
            playClaimAnimation()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.tr("activityCenter.day.reward", day.day, day.rewardActivityCatFood))
    }

    private func playClaimAnimation() {
        guard !reduceMotion else { return }
        withAnimation(ActivityMotion.rewardPop) {
            rewardScale = 1.22
            celebrationScale = 1.08
            celebrationOpacity = 1
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 190_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(ActivityMotion.rewardSettle) {
                rewardScale = 1
                celebrationScale = 1.34
                celebrationOpacity = 0
            }
        }
    }

    @ViewBuilder
    private var cellBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        if isClaimable {
            shape.fill(AppColors.accentGradient)
        } else if isFinal {
            shape.fill(
                LinearGradient(
                    colors: [AppColors.iconYellow.opacity(0.16), AppColors.accentLight],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        } else if isClaimed {
            shape.fill(AppColors.accentLight)
        } else {
            shape.fill(AppColors.secondaryBackground)
        }
    }

    private var cellBorderColor: Color {
        if isFinal { return AppColors.iconYellowDeep.opacity(0.28) }
        if isClaimed { return AppColors.accent.opacity(0.16) }
        return AppColors.separator
    }
}

private struct ActivityMealRow: View {
    let store: ActivityCenterStore
    let meal: ActivityMealReward
    let serverNow: Date
    @ObservedObject var operationStatus: ActivityCenterOperationStatus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isCompleted: Bool {
        meal.status == .claimed || meal.status == .completed
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "clock.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(AppColors.accent)
                .frame(width: 40, height: 40)
                .background(AppColors.accentLight, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(meal.displayTitle)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppColors.primaryText)
                Text("\(meal.startLocal)–\(meal.endLocal)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(AppColors.secondaryText)
                countdown
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 5) {
                ActivityRewardBadge(amount: meal.rewardActivityCatFood)
                Button {
                    ActivityTapFeedback.play()
                    Task { await store.claimMeal(meal) }
                } label: {
                    Text(isCompleted ? L10n.tr("activityCenter.claimed") : L10n.tr("activityCenter.claim"))
                        .frame(minWidth: 56)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(meal.status.canClaim ? .white : AppColors.secondaryText)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(
                            meal.status.canClaim ? AppColors.accent : AppColors.secondaryBackground,
                            in: Capsule()
                        )
                        .frame(minWidth: 64, minHeight: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(ActivityPressButtonStyle(pressedScale: 0.94))
                .disabled(!meal.status.canClaim || operationStatus.isRunning)
            }
        }
        .padding(.vertical, 8)
        .animation(reduceMotion ? nil : ActivityMotion.stateChange, value: meal.status)
        .animation(reduceMotion ? nil : ActivityMotion.stateChange, value: operationStatus.isRunning)
    }

    @ViewBuilder
    private var countdown: some View {
        if let transition = ActivityCenterDateParser.date(from: meal.nextTransitionAt) {
            let seconds = max(0, Int(transition.timeIntervalSince(serverNow)))
            if seconds > 0 {
                Text(ActivityDurationFormatter.string(seconds: seconds))
                    .font(.system(size: 11, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundStyle(AppColors.accent)
            }
        }
    }
}

private struct ActivityTaskRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let task: ActivityCenterTask
    @ObservedObject var operationStatus: ActivityCenterOperationStatus
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let isCompleted = task.status == .completed || task.status == .claimed
        Button {
            ActivityTapFeedback.play()
            action()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(AppColors.accent)
                    .frame(width: 40, height: 40)
                    .background(AppColors.accentLight, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppColors.primaryText)
                    Text(subtitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AppColors.secondaryText)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                if isCompleted {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(AppColors.accent)
                        .frame(width: 28, height: 28)
                        .background(AppColors.accentLight, in: Circle())
                } else {
                    ActivityRewardBadge(amount: task.rewardActivityCatFood)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(AppColors.tertiaryText)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(ActivityPressButtonStyle())
        .disabled(operationStatus.isRunning || isCompleted)
        .padding(.vertical, 13)
        .animation(reduceMotion ? nil : ActivityMotion.stateChange, value: task.status)
        .animation(reduceMotion ? nil : ActivityMotion.stateChange, value: operationStatus.isRunning)
        .accessibilityLabel(L10n.tr("activityCenter.task.claim", title, task.rewardActivityCatFood))
    }
}

private struct ActivityWheelView: View {
    let store: ActivityCenterStore
    let snapshot: ActivityCenterSnapshot
    let onResult: (ActivityWheelSpinResult) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settledRotation = 0.0
    @State private var motion: ActivityWheelMotion?
    @State private var spinningSegments: [ActivityWheelSegment]?

    private enum Motion {
        static let anticipationDegreesPerSecond = 420.0
        static let landingDuration = 4.0
        static let landingTurns = 6
        static let landingDurationNanoseconds: UInt64 = 4_000_000_000
        static let snapshotApplyDelayNanoseconds: UInt64 = 260_000_000
    }

    private static let runningButtonGradient = LinearGradient(
        colors: [AppColors.warningColor, AppColors.gradientEnd],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    private var tier: ActivityWheelTier { snapshot.wheel.currentTier }

    var body: some View {
        if snapshot.configVersion.isEmpty || tier.id.isEmpty || !tier.hasValidProbabilityTotal {
            ActivityUnavailableView(
                title: L10n.tr("activityCenter.tab.wheel"),
                systemImage: "giftcard",
                message: L10n.tr("activityCenter.error.wheelConfig")
            )
        } else {
            ScrollView {
                VStack(spacing: 18) {
                    wheelBalance
                    if let winner = snapshot.wheel.recentWinners.first {
                        Label(
                            L10n.tr("activityCenter.wheel.winner", winner.displayName, winner.payoutGoldCoins),
                            systemImage: "megaphone.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(AppColors.accent)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(AppColors.accentLight, in: Capsule())
                        .accessibilityElement(children: .combine)
                    }
                    ZStack(alignment: .top) {
                        rotatingWheelDisc
                        ActivityWheelPointer()
                            .offset(y: 3)
                    }
                    .frame(maxWidth: 344)
                    .padding(.top, 8)

                    ActivityOperationPrimaryButton(
                        title: L10n.tr("activityCenter.wheel.spin", tier.costGoldCoins),
                        operationStatus: store.operationStatus(for: .wheel),
                        isDisabled: !snapshot.wheel.enabled
                            || snapshot.goldCoinBalance < tier.costGoldCoins,
                        runningGradient: Self.runningButtonGradient
                    ) {
                        Task { await spin() }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
    }

    private var wheelBalance: some View {
        HStack(spacing: 10) {
            Image("wallet_gold_coin_badge")
                .resizable().scaledToFit().frame(width: 36, height: 36)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(L10n.tr("activityCenter.wheel.balance"))
                    .font(.caption).foregroundStyle(AppColors.secondaryText)
                Text(snapshot.goldCoinBalance.formatted()).font(.title2.bold())
            }
            Spacer()
            Text(L10n.tr("activityCenter.wheel.tier", tier.sequence))
                .font(.caption.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(AppColors.accent, in: Capsule())
        }
        .padding(14)
        .background(AppColors.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func spin() async {
        let segments = tier.displaySegments
        beginAnticipation(segments: segments)
        await Task.yield()

        guard let envelope = await store.spinWheel() else {
            settleCurrentMotion()
            return
        }

        let index = landingSegmentIndex(for: envelope.result, in: segments)
        let landingStartedAt = Date()
        let currentRotation = displayRotation(at: landingStartedAt)
        let target = ActivityWheelGeometry.landingRotation(
            from: currentRotation,
            segmentIndex: index,
            turns: Motion.landingTurns
        )

        if reduceMotion {
            settle(at: target)
        } else {
            beginLanding(
                at: landingStartedAt,
                from: currentRotation,
                to: target
            )
            try? await Task.sleep(nanoseconds: Motion.landingDurationNanoseconds)
            settle(at: target)
        }

        if reduceMotion {
            try? await Task.sleep(nanoseconds: 30_000_000)
        }
        ActivityTapFeedback.success()
        onResult(envelope.result)
        try? await Task.sleep(nanoseconds: Motion.snapshotApplyDelayNanoseconds)
        store.finishSpinAnimation()
    }

    private func beginAnticipation(segments: [ActivityWheelSegment]) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            spinningSegments = segments
            guard !reduceMotion else { return }
            motion = .anticipation(
                startedAt: Date(),
                startRotation: settledRotation,
                degreesPerSecond: Motion.anticipationDegreesPerSecond
            )
        }
    }

    private func beginLanding(at date: Date, from start: Double, to target: Double) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            motion = .landing(
                startedAt: date,
                startRotation: start,
                targetRotation: target,
                duration: Motion.landingDuration
            )
        }
    }

    private func displayRotation(at date: Date) -> Double {
        motion?.rotation(at: date) ?? settledRotation
    }

    private var rotatingWheelDisc: some View {
        TimelineView(.animation(paused: motion == nil || reduceMotion)) { context in
            wheelDisc(
                rotation: displayRotation(at: context.date),
                segments: spinningSegments ?? tier.displaySegments
            )
        }
    }

    private func wheelDisc(
        rotation: Double,
        segments: [ActivityWheelSegment]
    ) -> some View {
        ActivityWheelDisc(segments: segments)
            .rotationEffect(.degrees(rotation))
            .shadow(color: AppColors.accent.opacity(0.24), radius: 14, y: 6)
            .padding(12)
    }

    private func settleCurrentMotion(at date: Date = Date()) {
        settle(at: displayRotation(at: date))
    }

    private func settle(at rotation: Double) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            settledRotation = normalizedRotation(rotation)
            motion = nil
            spinningSegments = nil
        }
    }

    private func normalizedRotation(_ rotation: Double) -> Double {
        (rotation.truncatingRemainder(dividingBy: 360) + 360)
            .truncatingRemainder(dividingBy: 360)
    }

    private func landingSegmentIndex(
        for result: ActivityWheelSpinResult,
        in segments: [ActivityWheelSegment]
    ) -> Int {
        if let exactIndex = segments.firstIndex(where: { $0.id == result.prizeID }) {
            return exactIndex
        }
        if let payoutIndex = segments.firstIndex(where: {
            $0.payoutGoldCoins == result.payoutGoldCoins
        }) {
            return payoutIndex
        }
        return 0
    }
}

private struct ActivityWheelDisc: View {
    let segments: [ActivityWheelSegment]
    private let colors: [Color] = [
        AppColors.accent.opacity(0.16),
        AppColors.cardBackground,
        AppColors.gradientEnd.opacity(0.18),
        AppColors.accent.opacity(0.08)
    ]

    var body: some View {
        GeometryReader { proxy in
            let size = min(proxy.size.width, proxy.size.height)
            let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
            ZStack {
                ForEach(Array(segments.prefix(4).enumerated()), id: \.element.id) { index, segment in
                    ActivityWheelWedge(index: index)
                        .fill(colors[index])
                    VStack(spacing: 4) {
                        Text(segment.payoutGoldCoins.formatted())
                            .font(.title2.bold())
                            .foregroundStyle(AppColors.primaryText)
                        Image("wallet_gold_coin_badge")
                            .resizable().scaledToFit().frame(width: 24, height: 24)
                    }
                    .position(labelPosition(index: index, center: center, radius: size * 0.29))
                    .accessibilityHidden(true)
                }
                Circle().strokeBorder(AppColors.accent, lineWidth: 10)
                Circle().strokeBorder(
                    Color.white.opacity(0.55),
                    style: StrokeStyle(lineWidth: 2, dash: [3, 12])
                )
                    .padding(8)
                Circle()
                    .fill(AppColors.accentGradient)
                    .frame(width: 76, height: 76)
                    .overlay(Text(L10n.tr("activityCenter.wheel.spinShort")).font(.caption.bold()).foregroundStyle(.white))
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.tr("activityCenter.wheel.accessibility", segments.map(\.payoutGoldCoins).map(String.init).joined(separator: ", ")))
    }

    private func labelPosition(index: Int, center: CGPoint, radius: CGFloat) -> CGPoint {
        let degrees = -90.0 + (Double(index) + 0.5) * 90.0
        let radians = degrees * .pi / 180
        return CGPoint(
            x: center.x + CGFloat(cos(radians)) * radius,
            y: center.y + CGFloat(sin(radians)) * radius
        )
    }
}

private struct ActivityWheelWedge: Shape {
    let index: Int
    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        let start = Angle(degrees: -90 + Double(index) * 90)
        let end = Angle(degrees: -90 + Double(index + 1) * 90)
        var path = Path()
        path.move(to: center)
        path.addArc(center: center, radius: radius, startAngle: start, endAngle: end, clockwise: false)
        path.closeSubpath()
        return path
    }
}

private struct ActivityWheelPointer: View {
    var body: some View {
        Triangle()
            .fill(AppColors.iconYellow)
            .frame(width: 38, height: 38)
            .shadow(radius: 4, y: 2)
            .accessibilityHidden(true)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

private struct ActivityPhoneBindingOverlay: View {
    @ObservedObject var store: ActivityCenterStore
    let dismiss: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phone = ""
    @State private var code = ""
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case phone
        case code
    }

    private var normalizedPhoneInput: String {
        phone.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var normalizedCodeInput: String {
        code.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.34)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: dismiss)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .fill(AppColors.accentLight)
                            .frame(width: 44, height: 44)
                        Image(systemName: "phone.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(AppColors.accent)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(L10n.tr("activityCenter.phone.title"))
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(AppColors.primaryText)
                        Text(L10n.tr("activityCenter.phone.e164Hint"))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(AppColors.secondaryText)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)

                    Button {
                        ActivityTapFeedback.play()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(AppColors.secondaryText)
                            .frame(width: 34, height: 34)
                            .background(AppColors.secondaryBackground, in: Circle())
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(ActivityPressButtonStyle(pressedScale: 0.88))
                    .accessibilityLabel(L10n.tr("common.close"))
                }

                Divider().padding(.vertical, 16)

                VStack(alignment: .leading, spacing: 8) {
                    Text(L10n.tr("activityCenter.phone.number"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AppColors.secondaryText)

                    HStack(spacing: 10) {
                        Image(systemName: "phone")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(focusedField == .phone ? AppColors.accent : AppColors.secondaryText)
                            .frame(width: 20)
                    TextField(L10n.tr("activityCenter.phone.placeholder"), text: $phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .focused($focusedField, equals: .phone)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(AppColors.primaryText)
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 52)
                    .background(AppColors.secondaryBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(
                                focusedField == .phone ? AppColors.accent.opacity(0.7) : AppColors.separator,
                                lineWidth: focusedField == .phone ? 1.5 : 1
                            )
                    }

                    Text(L10n.tr("activityCenter.phone.e164Hint"))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AppColors.secondaryText)
                }

                ActivityOperationPrimaryButton(
                    title: L10n.tr("activityCenter.phone.sendCode"),
                    operationStatus: store.operationStatus(for: .sendCode),
                    isDisabled: normalizedPhoneInput.isEmpty
                ) {
                    Task {
                        if await store.requestPhoneCode(
                            rawPhone: normalizedPhoneInput,
                            region: store.snapshot?.phoneBinding.defaultRegion
                        ) {
                            focusedField = .code
                        }
                    }
                }
                .padding(.top, 14)

                if store.phoneVerificationSession != nil {
                    Divider().padding(.vertical, 16)

                    VStack(alignment: .leading, spacing: 8) {
                        Text(L10n.tr("activityCenter.phone.code"))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(AppColors.secondaryText)

                        HStack(spacing: 10) {
                            Image(systemName: "number")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(focusedField == .code ? AppColors.accent : AppColors.secondaryText)
                                .frame(width: 20)
                        TextField(L10n.tr("activityCenter.phone.codePlaceholder"), text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .focused($focusedField, equals: .code)
                            .font(.system(size: 16, weight: .medium, design: .rounded))
                            .foregroundStyle(AppColors.primaryText)
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 52)
                        .background(AppColors.secondaryBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(
                                    focusedField == .code ? AppColors.accent.opacity(0.7) : AppColors.separator,
                                    lineWidth: focusedField == .code ? 1.5 : 1
                                )
                        }
                    }

                    ActivityOperationPrimaryButton(
                        title: L10n.tr("activityCenter.phone.verify"),
                        operationStatus: store.operationStatus(for: .verifyPhone),
                        isDisabled: normalizedCodeInput.isEmpty
                    ) {
                        Task {
                            if await store.verifyPhone(code: normalizedCodeInput) {
                                dismiss()
                            }
                        }
                    }
                    .padding(.top, 12)
                }

                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(AppColors.accent)
                        .padding(.top, 1)
                    Text(L10n.tr("activityCenter.phone.privacy"))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AppColors.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .background(AppColors.accentLight.opacity(0.72), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                .padding(.top, 16)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 22)
            .frame(maxWidth: 360)
            .background(AppColors.cardBackground, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .stroke(.white.opacity(0.72), lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.18), radius: 28, y: 14)
            .padding(.horizontal, 18)
            .accessibilityElement(children: .contain)
        }
        .animation(
            reduceMotion ? nil : ActivityMotion.stateChange,
            value: store.phoneVerificationSession != nil
        )
        .onAppear { focusedField = .phone }
    }
}

private struct ActivityMatchesOverlay: View {
    @ObservedObject var store: ActivityCenterStore
    let dismiss: () -> Void
    @State private var requestedIDs: Set<String> = []

    var body: some View {
        ZStack {
            Color.black.opacity(0.34)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: dismiss)
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .fill(AppColors.accentLight)
                            .frame(width: 44, height: 44)
                        Image(systemName: "person.2.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(AppColors.accent)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L10n.tr("activityCenter.contacts.matches"))
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(AppColors.primaryText)
                        Text(L10n.tr("activityCenter.contacts.subtitle"))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Button {
                        ActivityTapFeedback.play()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(AppColors.secondaryText)
                            .frame(width: 34, height: 34)
                            .background(AppColors.secondaryBackground, in: Circle())
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(ActivityPressButtonStyle(pressedScale: 0.88))
                    .accessibilityLabel(L10n.tr("common.close"))
                }

                Divider().padding(.vertical, 14)

                if store.matchedUsers.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "person.2.slash")
                            .font(.system(size: 34, weight: .medium))
                            .foregroundStyle(AppColors.tertiaryText)
                        Text(L10n.tr("activityCenter.contacts.noMatches"))
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(AppColors.primaryText)
                        Text(L10n.tr("activityCenter.contacts.noMatchesHint"))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(AppColors.secondaryText)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 28)
                } else if store.matchedUsers.count <= 4 {
                    VStack(spacing: 0) {
                        matchesRows
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            matchesRows
                        }
                    }
                    .scrollIndicators(.hidden)
                    .frame(maxHeight: 336)
                }

                ActivityPrimaryButton(
                    title: L10n.tr("common.done"),
                    isLoading: false,
                    isDisabled: false,
                    action: dismiss
                )
                .padding(.top, 18)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 22)
            .frame(maxWidth: 360)
            .background(AppColors.cardBackground, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .stroke(.white.opacity(0.72), lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.18), radius: 28, y: 14)
            .padding(.horizontal, 18)
            .accessibilityElement(children: .contain)
        }
    }

    @ViewBuilder
    private var matchesRows: some View {
        ForEach(Array(store.matchedUsers.enumerated()), id: \.element.id) { index, user in
            ActivityMatchedUserRow(
                store: store,
                user: user,
                isRequested: requestedIDs.contains(user.id),
                operationStatus: store.operationStatus(for: .friend(user.id))
            ) {
                requestedIDs.insert(user.id)
            }
            if index < store.matchedUsers.count - 1 {
                Divider().padding(.leading, 58)
            }
        }
    }
}

private struct ActivityMatchedUserRow: View {
    let store: ActivityCenterStore
    let user: ActivityMatchedUser
    let isRequested: Bool
    @ObservedObject var operationStatus: ActivityCenterOperationStatus
    let onRequested: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isOptimisticallyRequested = false

    private var appearsRequested: Bool {
        isRequested || isOptimisticallyRequested
    }

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(url: user.avatarURL, size: 46)
            Text(user.nickname)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(AppColors.primaryText)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button {
                ActivityTapFeedback.play()
                isOptimisticallyRequested = true
                Task {
                    if await store.sendFriendRequest(to: user) {
                        onRequested()
                    } else {
                        isOptimisticallyRequested = false
                    }
                }
            } label: {
                Text(appearsRequested
                    ? L10n.tr("activityCenter.contacts.sent")
                    : L10n.tr("activityCenter.contacts.add"))
                    .font(.system(size: 12, weight: .bold))
                    .frame(minWidth: 44)
                .foregroundStyle(appearsRequested ? AppColors.secondaryText : AppColors.accent)
                .padding(.horizontal, 10)
                .frame(minHeight: 40)
                .background(
                    appearsRequested ? AppColors.secondaryBackground : AppColors.accentLight,
                    in: Capsule()
                )
            }
            .buttonStyle(ActivityPressButtonStyle(pressedScale: 0.94))
            .disabled(appearsRequested || operationStatus.isRunning)
        }
        .padding(.vertical, 10)
        .animation(reduceMotion ? nil : ActivityMotion.stateChange, value: isRequested)
        .animation(reduceMotion ? nil : ActivityMotion.stateChange, value: operationStatus.isRunning)
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: L10n.tr("activityCenter.contacts.add")) {
            guard !appearsRequested, !operationStatus.isRunning else { return }
            isOptimisticallyRequested = true
            Task {
                if await store.sendFriendRequest(to: user) {
                    onRequested()
                } else {
                    isOptimisticallyRequested = false
                }
            }
        }
    }
}

private struct ActivityInviteRedeemSheet: View {
    let store: ActivityCenterStore
    @ObservedObject var operationStatus: ActivityCenterOperationStatus
    @Environment(\.dismiss) private var dismiss
    @State private var input = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L10n.tr("activityCenter.invite.inputPlaceholder"), text: $input)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    Button {
                        ActivityTapFeedback.play()
                        Task { if await store.redeemInvite(input) { dismiss() } }
                    } label: {
                        Text(L10n.tr("activityCenter.invite.redeem"))
                    }
                    .disabled(
                        input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || operationStatus.isRunning
                    )
                } footer: {
                    Text(L10n.tr("activityCenter.invite.redeemHint"))
                }
            }
            .navigationTitle(L10n.tr("activityCenter.invite.redeem"))
            .navigationBarTitleDisplayMode(.inline)
            .tint(AppColors.accent)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.tr("common.cancel")) { dismiss() }
                }
            }
        }
    }
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let session: ActivityInviteShareSession
    let completion: (Bool) -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let message = "\(session.message)\n\(session.shareURL)\n\(session.inviteCode)"
        let controller = UIActivityViewController(activityItems: [message], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, completed, _, _ in
            completion(completed)
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private struct ActivityWheelResultOverlay: View {
    let result: ActivityWheelSpinResult
    let dismiss: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isPresented = false

    var body: some View {
        ZStack {
            Color.clear
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: dismiss)
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button {
                        ActivityTapFeedback.play()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(AppColors.secondaryText)
                            .frame(width: 34, height: 34)
                            .background(AppColors.secondaryBackground, in: Circle())
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(ActivityPressButtonStyle(pressedScale: 0.88))
                    .accessibilityLabel(L10n.tr("common.close"))
                }

                ZStack {
                    Circle()
                        .fill(AppColors.iconYellow.opacity(0.14))
                        .frame(width: 104, height: 104)
                    Circle()
                        .stroke(AppColors.iconYellowDeep.opacity(0.22), lineWidth: 1)
                        .frame(width: 88, height: 88)
                    Image("wallet_gold_coin_badge")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 78, height: 78)
                        .accessibilityHidden(true)
                }
                .padding(.top, 2)
                .scaleEffect(isPresented ? 1 : 0.78)
                .opacity(isPresented ? 1 : 0)

                Text(L10n.tr("activityCenter.wheel.resultTitle"))
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(AppColors.primaryText)
                    .padding(.top, 14)
                    .offset(y: isPresented ? 0 : 8)
                    .opacity(isPresented ? 1 : 0)

                Text("+\(result.payoutGoldCoins)")
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .foregroundStyle(AppColors.accent)
                    .monospacedDigit()
                    .padding(.top, 6)
                    .scaleEffect(isPresented ? 1 : 0.86)
                    .opacity(isPresented ? 1 : 0)

                ActivityPrimaryButton(
                    title: L10n.tr("common.confirm"),
                    isLoading: false,
                    isDisabled: false,
                    action: dismiss
                )
                .padding(.top, 22)
                .offset(y: isPresented ? 0 : 8)
                .opacity(isPresented ? 1 : 0)
            }
            .padding(.horizontal, 22)
            .padding(.top, 14)
            .padding(.bottom, 24)
            .frame(maxWidth: 336)
            .background(AppColors.cardBackground, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .stroke(.white.opacity(0.72), lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.18), radius: 28, y: 14)
            .padding(.horizontal, 24)
            .accessibilityElement(children: .contain)
        }
        .onAppear {
            if reduceMotion {
                isPresented = true
            } else {
                Task { @MainActor in
                    await Task.yield()
                    withAnimation(ActivityMotion.rewardSettle) {
                        isPresented = true
                    }
                }
            }
        }
    }
}

private struct ActivityCard<Content: View>: View {
    @ViewBuilder let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        content
            .padding(18)
            .background(AppColors.cardBackground, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(AppColors.separator, lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.025), radius: 10, y: 4)
    }
}

private struct ActivityRewardCelebrationOverlay: View {
    let celebration: ActivityRewardCelebration
    let onFinished: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var burstScale = 0.62
    @State private var burstRotation = -10.0
    @State private var burstOpacity = 0.0
    @State private var rewardScale = 0.76
    @State private var rewardOffset = 14.0
    @State private var rewardOpacity = 0.0
    @State private var animationTask: Task<Void, Never>?

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Image("activity_claim_burst")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 224, height: 224)
                    .scaleEffect(burstScale)
                    .rotationEffect(.degrees(burstRotation))
                    .opacity(burstOpacity)

                VStack(spacing: 9) {
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [AppColors.cardBackground, AppColors.accentLight],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 92, height: 92)
                            .overlay {
                                Circle()
                                    .stroke(AppColors.iconYellow.opacity(0.28), lineWidth: 1)
                            }
                            .shadow(color: AppColors.iconYellowDeep.opacity(0.2), radius: 14, y: 7)

                        Image("activity_reward_paw")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 68, height: 68)
                    }

                    Text("+\(L10n.tr("activityCenter.reward.catFood", celebration.amount))")
                        .font(.system(size: 20, weight: .bold, design: .rounded))
                        .foregroundStyle(AppColors.primaryText)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 40)
                        .background(AppColors.cardBackground.opacity(0.96), in: Capsule())
                        .overlay {
                            Capsule().stroke(AppColors.separator, lineWidth: 1)
                        }
                        .shadow(color: Color.black.opacity(0.08), radius: 10, y: 5)
                }
                .scaleEffect(rewardScale)
                .offset(y: rewardOffset)
                .opacity(rewardOpacity)
            }
            .position(x: proxy.size.width / 2, y: proxy.size.height * 0.46)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.tr("activityCenter.reward.catFood", celebration.amount))
        .onAppear(perform: play)
        .onDisappear { animationTask?.cancel() }
    }

    private func play() {
        animationTask?.cancel()
        ActivityTapFeedback.success()
        UIAccessibility.post(
            notification: .announcement,
            argument: L10n.tr("activityCenter.reward.catFood", celebration.amount)
        )

        animationTask = Task { @MainActor in
            if reduceMotion {
                withAnimation(.easeOut(duration: 0.18)) {
                    burstOpacity = 0.86
                    rewardOpacity = 1
                }
                try? await Task.sleep(nanoseconds: 700_000_000)
                guard !Task.isCancelled else { return }
                withAnimation(.easeIn(duration: 0.18)) {
                    burstOpacity = 0
                    rewardOpacity = 0
                }
                try? await Task.sleep(nanoseconds: 200_000_000)
                guard !Task.isCancelled else { return }
                onFinished()
                return
            }

            withAnimation(.spring(response: 0.38, dampingFraction: 0.66)) {
                burstScale = 1
                burstRotation = 0
                burstOpacity = 1
                rewardScale = 1
                rewardOffset = 0
                rewardOpacity = 1
            }

            try? await Task.sleep(nanoseconds: 420_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.58)) {
                burstScale = 1.3
                burstRotation = 24
                burstOpacity = 0
                rewardOffset = -24
            }

            try? await Task.sleep(nanoseconds: 430_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                rewardScale = 1.04
                rewardOffset = -31
                rewardOpacity = 0
            }

            try? await Task.sleep(nanoseconds: 220_000_000)
            guard !Task.isCancelled else { return }
            onFinished()
        }
    }
}

private struct ActivitySectionTitle: View {
    let title: String
    let subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(AppColors.primaryText)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AppColors.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ActivityRewardBadge: View {
    let amount: Int
    var body: some View {
        HStack(spacing: 4) {
            Image("activity_reward_paw")
                .resizable()
                .scaledToFit()
                .frame(width: 18, height: 18)
            Text("+\(amount)")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .monospacedDigit()
        }
        .foregroundStyle(AppColors.primaryText)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            AppColors.iconYellow.opacity(0.16),
            in: Capsule()
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.tr("activityCenter.reward.catFood", amount))
    }
}

private struct ActivityOperationPrimaryButton: View {
    let title: String
    @ObservedObject var operationStatus: ActivityCenterOperationStatus
    let isDisabled: Bool
    var runningGradient: LinearGradient? = nil
    let action: () -> Void

    var body: some View {
        ActivityPrimaryButton(
            title: title,
            isLoading: operationStatus.isRunning,
            isDisabled: isDisabled,
            runningGradient: runningGradient,
            action: action
        )
    }
}

private struct ActivityPressButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var pressedScale = 0.98
    var pressedOpacity = 0.86

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? pressedScale : 1)
            .opacity(configuration.isPressed ? pressedOpacity : 1)
            .animation(
                reduceMotion ? nil : ActivityMotion.tap,
                value: configuration.isPressed
            )
    }
}

@MainActor
private enum ActivityTapFeedback {
    private static let generator: UISelectionFeedbackGenerator = {
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        return generator
    }()
    private static let notificationGenerator: UINotificationFeedbackGenerator = {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        return generator
    }()

    static func play() {
        generator.selectionChanged()
        generator.prepare()
    }

    static func success() {
        notificationGenerator.notificationOccurred(.success)
        notificationGenerator.prepare()
    }
}

private struct ActivityPrimaryButton: View {
    let title: String
    let isLoading: Bool
    let isDisabled: Bool
    var runningGradient: LinearGradient? = nil
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isUnavailable: Bool {
        isDisabled || isLoading
    }

    var body: some View {
        Button {
            guard !isUnavailable else { return }
            ActivityTapFeedback.play()
            action()
        } label: {
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .frame(maxWidth: .infinity)
                .frame(minHeight: 50)
                .foregroundStyle(isDisabled && !isLoading ? AppColors.primaryText.opacity(0.58) : .white)
                .background {
                    let shape = RoundedRectangle(cornerRadius: 15, style: .continuous)
                    if isDisabled && !isLoading {
                        shape.fill(AppColors.cardBackground)
                    } else {
                        let gradient = isLoading
                            ? runningGradient ?? AppColors.accentGradient
                            : AppColors.accentGradient
                        shape.fill(gradient)
                            .shadow(
                                color: (isLoading ? AppColors.warningColor : AppColors.accent).opacity(0.22),
                                radius: 9,
                                y: 4
                            )
                    }
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                        .stroke(
                            isDisabled && !isLoading
                                ? AppColors.accent.opacity(0.2)
                                : .white.opacity(0.12),
                            lineWidth: 1
                        )
                }
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: 0.32),
                    value: isLoading
                )
        }
        .buttonStyle(ActivityPressButtonStyle(pressedScale: 0.985, pressedOpacity: 0.9))
        .allowsHitTesting(!isUnavailable)
    }
}

private enum ActivityDurationFormatter {
    static func string(seconds: Int) -> String {
        let clamped = max(0, seconds)
        return String(format: "%02d:%02d:%02d", clamped / 3600, (clamped / 60) % 60, clamped % 60)
    }
}

private struct ActivityUnavailableView: View {
    let title: String
    let systemImage: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 40))
                .foregroundStyle(AppColors.tertiaryText)
            Text(title).font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(AppColors.secondaryText)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ActivityCenterView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            ActivityCenterView(store: ActivityCenterStore(initialSnapshot: .preview))
        }
        .environmentObject(UIKitNavigator())
    }
}
