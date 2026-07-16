import SwiftUI

struct ShortDramaSeriesListView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = ShortDramaSeriesListViewModel()
    @State private var selectedFilter: ShortDramaSeriesFilter = .recommended

    var body: some View {
        ShortDramaSeriesListContent(
            series: viewModel.series(for: selectedFilter),
            isLoading: viewModel.isLoading(filter: selectedFilter),
            isLoadingMore: viewModel.isLoadingMore(filter: selectedFilter),
            errorMessage: viewModel.errorMessage(for: selectedFilter),
            onOpenSeries: openSeries,
            onOpenEpisode: openEpisode,
            onLoadMore: loadMore
        )
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(Color.clear, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .hidesTabBarOnPush()
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton(tint: AppColors.primaryText) {
                    navigator.pop()
                }
            }

            ToolbarItem(placement: .principal) {
                ShortDramaSeriesFilterBar(selection: $selectedFilter)
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: openCreate) {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("shortDrama.series.create"))
            }
        }
        .task(id: selectedFilter) {
            await viewModel.loadInitial(filter: selectedFilter)
        }
        .refreshable {
            await viewModel.refresh(filter: selectedFilter)
        }
        .onReceive(NotificationCenter.default.publisher(for: .shortDramaHistoryDidChange)) { _ in
            viewModel.applyLocalHistory()
        }
    }

    private func openCreate() {
        navigator.push(ShortDramaUnifiedEditorView(mode: .create) { _ in
            Task { await viewModel.refresh(filter: selectedFilter) }
        })
    }

    private func openSeries(_ series: ShortDramaSeries) {
        openPlayer(series: series, episodeID: series.resumeEpisodeID, position: series.resumePositionSeconds)
    }

    private func openEpisode(_ episode: ShortDramaVideo, in series: ShortDramaSeries) {
        openPlayer(series: series, episodeID: episode.id, position: 0)
    }

    private func openPlayer(series: ShortDramaSeries, episodeID: String?, position: Double) {
        navigator.push(
            ShortDramaFeedView(
                viewModel: ShortDramaFeedViewModel(
                    seriesID: series.id,
                    initialEpisodeID: episodeID,
                    initialPositionSeconds: position
                )
            )
        )
    }

    private func loadMore(_ seriesID: String) {
        viewModel.loadMoreIfNeeded(filter: selectedFilter, currentSeriesID: seriesID)
    }
}

private struct ShortDramaSeriesFilterBar: View {
    @Binding var selection: ShortDramaSeriesFilter

    var body: some View {
        SystemSegmentedTabs(
            items: ShortDramaSeriesFilter.allCases,
            selection: $selection,
            title: { $0.localizedTitle },
            accessibilityIdentifier: "shortDrama.top.tabs"
        )
        .frame(width: 196)
        .accessibilityElement(children: .contain)
    }
}

private struct ShortDramaSeriesListContent: View {
    let series: [ShortDramaSeries]
    let isLoading: Bool
    let isLoadingMore: Bool
    let errorMessage: String?
    let onOpenSeries: (ShortDramaSeries) -> Void
    let onOpenEpisode: (ShortDramaVideo, ShortDramaSeries) -> Void
    let onLoadMore: (String) -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 14) {
                ForEach(series) { item in
                    ShortDramaSeriesCard(
                        series: item,
                        showsCreator: true,
                        showsPublishStatus: false,
                        onOpenSeries: { onOpenSeries(item) },
                        onOpenEpisode: { onOpenEpisode($0, item) }
                    )
                    .onAppear { onLoadMore(item.id) }
                }

                if isLoading || isLoadingMore {
                    ProgressView().tint(AppColors.accent).padding(28)
                } else if series.isEmpty {
                    ShortDramaSeriesEmptyState(errorMessage: errorMessage)
                }
            }
            .padding(16)
        }
        .overlay(alignment: .top) {
            if let errorMessage, !series.isEmpty {
                Text(errorMessage)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(AppColors.errorColor)
                    .clipShape(Capsule())
                    .padding(.top, 8)
            }
        }
    }
}

struct ShortDramaSeriesCard: View {
    let series: ShortDramaSeries
    let showsCreator: Bool
    let showsPublishStatus: Bool
    let onOpenSeries: () -> Void
    let onOpenEpisode: (ShortDramaVideo) -> Void

    @State private var loadedEpisodes: [ShortDramaVideo]
    @State private var currentPage = 0
    @State private var isLoadingEpisodes = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 5)
    private let episodePageSize = 15

    private var episodes: [ShortDramaVideo] {
        loadedEpisodes.sorted {
            ($0.episodeNumber ?? Int.max, $0.id) < ($1.episodeNumber ?? Int.max, $1.id)
        }
    }

    private var expectedEpisodeCount: Int {
        max(series.episodeCount, episodes.count)
    }

    private var pageCount: Int {
        max(1, Int(ceil(Double(expectedEpisodeCount) / Double(episodePageSize))))
    }

    private var visibleSlots: [ShortDramaEpisodeSlot] {
        guard expectedEpisodeCount > 0 else { return [] }
        let start = currentPage * episodePageSize + 1
        let end = min(expectedEpisodeCount, start + episodePageSize - 1)
        let range = start...max(start, end)
        return range.map { number in
            ShortDramaEpisodeSlot(
                number: number,
                episode: episodes.indices.contains(number - 1) ? episodes[number - 1] : nil
            )
        }
    }

    init(
        series: ShortDramaSeries,
        showsCreator: Bool,
        showsPublishStatus: Bool,
        onOpenSeries: @escaping () -> Void,
        onOpenEpisode: @escaping (ShortDramaVideo) -> Void
    ) {
        self.series = series
        self.showsCreator = showsCreator
        self.showsPublishStatus = showsPublishStatus
        self.onOpenSeries = onOpenSeries
        self.onOpenEpisode = onOpenEpisode
        _loadedEpisodes = State(initialValue: series.episodes)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onOpenSeries) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(series.title)
                            .font(.headline.weight(.bold))
                            .foregroundColor(AppColors.primaryText)
                            .lineLimit(2)
                        if showsPublishStatus {
                            ShortDramaSeriesStatusPill(status: series.status)
                        }
                    }

                    ShortDramaPosterView(url: series.coverURL)
                        .frame(maxWidth: .infinity)
                        .frame(height: 131)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    (Text(L10n.tr("shortDrama.series.introLabel"))
                        .fontWeight(.semibold)
                        + Text(series.intro.isBlank ? L10n.tr("shortDrama.series.noIntro") : series.intro))
                        .font(.subheadline)
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 12) {
                if expectedEpisodeCount > 0 {
                    ShortDramaEpisodeRangePicker(
                        currentPage: currentPage,
                        pageCount: pageCount,
                        episodeCount: expectedEpisodeCount,
                        pageSize: episodePageSize,
                        onSelect: selectPage
                    )
                }

                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(visibleSlots) { slot in
                        Button { openEpisode(slot) } label: {
                            ShortDramaEpisodeSquare(
                                number: slot.number,
                                episode: slot.episode,
                                showsPublishStatus: showsPublishStatus,
                                isLoading: isLoadingEpisodes && slot.episode == nil
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(L10n.tr("shortDrama.episode", slot.number))
                    }
                }
            }
            .padding(.top, 14)

            if showsCreator {
                Divider()
                    .opacity(0.5)
                    .padding(.top, 14)

                HStack(spacing: 10) {
                    UserAvatarButton(
                        userID: series.creator.userID,
                        avatarURL: series.creator.avatarURL,
                        size: 44,
                        accessibilityName: series.creator.nickname
                    )

                    Text(L10n.tr("shortDrama.series.uploadedBy", series.creator.nickname))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                }
                .frame(minHeight: 44)
                .padding(.top, 10)
            }
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
        .onChange(of: series.episodes) { updated in
            mergeEpisodes(updated)
        }
        .task(id: series.id) {
            await loadFullEpisodeListIfNeeded()
        }
    }

    private func selectPage(_ page: Int) {
        guard page >= 0, page < pageCount else { return }
        withAnimation(.easeInOut(duration: 0.18)) { currentPage = page }
    }

    private func openEpisode(_ slot: ShortDramaEpisodeSlot) {
        if let episode = slot.episode {
            onOpenEpisode(episode)
            return
        }
        Task {
            await loadFullEpisodeListIfNeeded()
            let index = slot.number - 1
            if episodes.indices.contains(index) {
                onOpenEpisode(episodes[index])
            }
        }
    }

    private func loadFullEpisodeListIfNeeded() async {
        guard !isLoadingEpisodes, expectedEpisodeCount > loadedEpisodes.count else { return }
        isLoadingEpisodes = true
        defer { isLoadingEpisodes = false }
        do {
            let detail = try await APIService.shared.getShortDramaSeriesDetail(seriesID: series.id)
            guard !Task.isCancelled else { return }
            mergeEpisodes(detail.episodes)
        } catch {
            return
        }
    }

    private func mergeEpisodes(_ incoming: [ShortDramaVideo]) {
        var byID = Dictionary(uniqueKeysWithValues: loadedEpisodes.map { ($0.id, $0) })
        for episode in incoming { byID[episode.id] = episode }
        loadedEpisodes = Array(byID.values)
        currentPage = min(currentPage, max(0, pageCount - 1))
    }
}

private struct ShortDramaEpisodeSquare: View {
    let number: Int
    let episode: ShortDramaVideo?
    let showsPublishStatus: Bool
    let isLoading: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColors.secondaryBackground)
            Text("\(number)")
                .font(.subheadline.weight(.bold))
                .foregroundColor(episode == nil ? AppColors.tertiaryText : AppColors.primaryText)

            if episode?.requiresUnlock == true {
                VStack {
                    HStack {
                        Spacer()
                        Image(systemName: "lock.fill")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(AppColors.accent)
                    }
                    Spacer()
                }
                .padding(6)
            }

            if showsPublishStatus, let status = episode?.publishStatus {
                VStack {
                    Spacer()
                    Circle()
                        .fill(ShortDramaSeriesStatusPill.color(for: status))
                        .frame(width: 7, height: 7)
                        .padding(5)
                }
            }

            if isLoading {
                ProgressView()
                    .tint(AppColors.accent)
                    .scaleEffect(0.65)
            }
        }
        .frame(height: 44)
    }
}

private struct ShortDramaEpisodeSlot: Identifiable {
    let number: Int
    let episode: ShortDramaVideo?
    var id: Int { number }
}

private struct ShortDramaEpisodeRangePicker: View {
    let currentPage: Int
    let pageCount: Int
    let episodeCount: Int
    let pageSize: Int
    let onSelect: (Int) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 20) {
                ForEach(0..<pageCount, id: \.self) { page in
                    Button {
                        onSelect(page)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(rangeTitle(for: page))
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(page == currentPage ? .black : AppColors.secondaryText)
                                .lineLimit(1)

                            Capsule()
                                .fill(page == currentPage ? Color.black : Color.clear)
                                .frame(width: 38, height: 3)
                        }
                        .frame(minWidth: 76, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(page == currentPage ? .isSelected : [])
                }
            }
        }
        .padding(.bottom, 12)
        .overlay(alignment: .bottom) {
            Divider()
                .opacity(0.5)
        }
    }

    private func rangeTitle(for page: Int) -> String {
        let start = page * pageSize + 1
        let end = min(episodeCount, start + pageSize - 1)
        return "\(start) – \(end)"
    }
}

struct ShortDramaPosterView: View {
    let url: String
    var image: UIImage? = nil
    var placeholderColors: [Color] = [Color(hex: "2B2D42"), Color(hex: "7C3AED"), Color(hex: "FF4D8D")]
    @State private var remoteImage: UIImage?

    var body: some View {
        ZStack {
            LinearGradient(
                colors: placeholderColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let remoteImage {
                Image(uiImage: remoteImage).resizable().scaledToFill()
            } else {
                Image(systemName: "play.rectangle.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundColor(.white.opacity(0.9))
            }
        }
        .clipped()
        .task(id: url) {
            guard image == nil, !url.isBlank else { return }
            remoteImage = await ImageCacheManager.shared.loadImage(from: url)
        }
    }
}

struct ShortDramaSeriesStatusPill: View {
    let status: ShortDramaPublishStatus

    var body: some View {
        Text(status.localizedTitle)
            .font(.caption2.weight(.bold))
            .foregroundColor(Self.color(for: status))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Self.color(for: status).opacity(0.12))
            .clipShape(Capsule())
    }

    static func color(for status: ShortDramaPublishStatus) -> Color {
        switch status {
        case .published: return AppColors.online
        case .processing, .reviewing: return AppColors.accent
        case .rejected, .failed: return AppColors.errorColor
        case .draft, .unknown: return AppColors.secondaryText
        }
    }
}

private struct ShortDramaSeriesEmptyState: View {
    let errorMessage: String?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: errorMessage == nil ? "play.rectangle.stack" : "exclamationmark.triangle")
                .font(.largeTitle.weight(.semibold))
                .foregroundColor(AppColors.accent)
            Text(errorMessage ?? L10n.tr("shortDrama.empty"))
                .font(.subheadline.weight(.semibold))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }
}

@MainActor
final class ShortDramaSeriesListViewModel: ObservableObject {
    @Published private var recommended: [ShortDramaSeries] = []
    @Published private var watched: [ShortDramaSeries] = []
    @Published private var loadingFilters = Set<ShortDramaSeriesFilter>()
    @Published private var loadingMoreFilters = Set<ShortDramaSeriesFilter>()
    @Published private var errors: [ShortDramaSeriesFilter: String] = [:]

    private var loadedFilters = Set<ShortDramaSeriesFilter>()
    private var cursors: [ShortDramaSeriesFilter: String] = [:]
    private var hasMore: [ShortDramaSeriesFilter: Bool] = [.recommended: true, .watched: true]

    init() {
        for filter in ShortDramaSeriesFilter.allCases {
            guard let key = cacheKey(for: filter),
                  let cached: CachedSnapshot<ShortDramaSeriesPage> = AppCacheRepository.shared.cachedValue(for: key) else { continue }
            apply(page: cached.value, filter: filter, reset: true)
        }
    }

    func series(for filter: ShortDramaSeriesFilter) -> [ShortDramaSeries] {
        filter == .recommended ? recommended : watched
    }

    func isLoading(filter: ShortDramaSeriesFilter) -> Bool { loadingFilters.contains(filter) }
    func isLoadingMore(filter: ShortDramaSeriesFilter) -> Bool { loadingMoreFilters.contains(filter) }
    func errorMessage(for filter: ShortDramaSeriesFilter) -> String? { errors[filter] }

    func loadInitial(filter: ShortDramaSeriesFilter) async {
        guard !loadedFilters.contains(filter) else {
            applyLocalHistory()
            return
        }
        await load(filter: filter, reset: true, forceRefresh: false)
    }

    func refresh(filter: ShortDramaSeriesFilter) async {
        await load(filter: filter, reset: true, forceRefresh: true)
    }

    func loadMoreIfNeeded(filter: ShortDramaSeriesFilter, currentSeriesID: String) {
        let items = series(for: filter)
        guard items.last?.id == currentSeriesID,
              hasMore[filter] == true,
              !loadingFilters.contains(filter),
              !loadingMoreFilters.contains(filter) else { return }
        Task { await load(filter: filter, reset: false, forceRefresh: false) }
    }

    func applyLocalHistory() {
        recommended = recommended.map(Self.applyingHistory)
        watched = watched.map(Self.applyingHistory)
            .sorted { ($0.lastWatchedAt ?? "") > ($1.lastWatchedAt ?? "") }
    }

    private func load(filter: ShortDramaSeriesFilter, reset: Bool, forceRefresh: Bool) async {
        if reset {
            loadingFilters.insert(filter)
            cursors[filter] = nil
            hasMore[filter] = true
        } else {
            loadingMoreFilters.insert(filter)
        }
        errors[filter] = nil
        defer {
            loadingFilters.remove(filter)
            loadingMoreFilters.remove(filter)
        }

        do {
            let fetch: () async throws -> ShortDramaSeriesPage = {
                try await APIService.shared.getShortDramaSeriesFeed(
                    filter: filter,
                    cursor: reset ? nil : self.cursors[filter]
                )
            }
            let page: ShortDramaSeriesPage
            if reset, let key = cacheKey(for: filter) {
                page = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .mediaFeed,
                    forceRefresh: forceRefresh,
                    fetch: fetch
                )
            } else {
                page = try await fetch()
            }
            apply(page: page, filter: filter, reset: reset)
        } catch {
            guard !Self.isCancellation(error) else { return }
            await loadLegacyFallback(filter: filter, reset: reset, originalError: error)
        }
    }

    private func loadLegacyFallback(
        filter: ShortDramaSeriesFilter,
        reset: Bool,
        originalError: Error
    ) async {
        guard !Self.isCancellation(originalError) else { return }
        guard reset else {
            errors[filter] = originalError.localizedDescription
            return
        }
        do {
            let page = try await APIService.shared.getShortDramaFeed(limit: 60)
            var grouped = Self.groupLegacyVideos(page.videos).map(Self.applyingHistory)
            if filter == .watched {
                grouped = grouped.filter { ShortDramaHistoryStore.shared.record(for: $0.id) != nil }
                    .sorted { ($0.lastWatchedAt ?? "") > ($1.lastWatchedAt ?? "") }
            }
            apply(
                page: ShortDramaSeriesPage(series: grouped, hasMore: false, nextCursor: nil),
                filter: filter,
                reset: true
            )
        } catch {
            guard !Self.isCancellation(error) else { return }
            errors[filter] = originalError.localizedDescription
        }
    }

    private func apply(page: ShortDramaSeriesPage, filter: ShortDramaSeriesFilter, reset: Bool) {
        let incoming = page.series.map(Self.applyingHistory)
        var items = reset ? incoming : series(for: filter) + incoming
        var seen = Set<String>()
        items = items.filter { seen.insert($0.id).inserted }
        if filter == .recommended { recommended = items } else { watched = items }
        if reset { loadedFilters.insert(filter) }
        hasMore[filter] = page.hasMore
        cursors[filter] = page.nextCursor
        if let key = cacheKey(for: filter) {
            let cachedPage = ShortDramaSeriesPage(
                series: Array(items.prefix(200)),
                hasMore: page.hasMore,
                nextCursor: page.nextCursor
            )
            AppCacheRepository.shared.save(cachedPage, for: key, policy: .mediaFeed)
        }
    }

    private func cacheKey(for filter: ShortDramaSeriesFilter) -> CacheKey? {
        CacheKey.current(namespace: "short-drama-series", key: filter.rawValue)
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError || Task.isCancelled { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        if case APIError.networkError(let underlying) = error {
            return isCancellation(underlying)
        }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    private static func groupLegacyVideos(_ videos: [ShortDramaVideo]) -> [ShortDramaSeries] {
        Dictionary(grouping: videos) { $0.dramaID.isBlank ? $0.id : $0.dramaID }
            .map { id, episodes in
                let sorted = episodes.sorted { ($0.episodeNumber ?? Int.max) < ($1.episodeNumber ?? Int.max) }
                let first = sorted[0]
                return ShortDramaSeries(
                    seriesID: id,
                    title: first.dramaTitle.isBlank ? first.displayTitle : first.dramaTitle,
                    intro: first.intro,
                    coverURL: first.coverURL,
                    episodeCount: sorted.count,
                    status: .published,
                    episodes: sorted,
                    creator: first.creator
                )
            }
    }

    private static func applyingHistory(_ series: ShortDramaSeries) -> ShortDramaSeries {
        guard let record = ShortDramaHistoryStore.shared.record(for: series.id) else { return series }
        return ShortDramaSeries(
            seriesID: series.id,
            title: series.title,
            intro: series.intro,
            coverURL: series.coverURL,
            episodeCount: series.episodeCount,
            status: series.status,
            statusMessage: series.statusMessage,
            updatedAt: series.updatedAt,
            episodes: series.episodes,
            creator: series.creator,
            resumeEpisodeID: record.episodeID,
            resumePositionSeconds: record.positionSeconds,
            lastWatchedAt: record.watchedAt
        )
    }
}

struct ShortDramaHistoryRecord: Codable, Equatable {
    let seriesID: String
    let episodeID: String
    let positionSeconds: Double
    let watchedAt: String
}

@MainActor
final class ShortDramaHistoryStore {
    static let shared = ShortDramaHistoryStore()
    private let lock = NSLock()

    private var storageKey: String {
        "bbchat.shortDrama.history.\(AuthManager.shared.currentUser?.userID ?? "guest")"
    }

    func record(for seriesID: String) -> ShortDramaHistoryRecord? {
        lock.withLock { records()[seriesID] }
    }

    func save(seriesID: String, episodeID: String, positionSeconds: Double) {
        guard !seriesID.isBlank, !episodeID.isBlank else { return }
        lock.withLock {
            var next = records()
            next[seriesID] = ShortDramaHistoryRecord(
                seriesID: seriesID,
                episodeID: episodeID,
                positionSeconds: max(0, positionSeconds),
                watchedAt: ISO8601DateFormatter().string(from: Date())
            )
            if let data = try? JSONEncoder().encode(next) {
                UserDefaults.standard.set(data, forKey: storageKey)
            }
        }
        NotificationCenter.default.post(name: .shortDramaHistoryDidChange, object: nil)
    }

    private func records() -> [String: ShortDramaHistoryRecord] {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return [:] }
        return (try? JSONDecoder().decode([String: ShortDramaHistoryRecord].self, from: data)) ?? [:]
    }
}

extension Notification.Name {
    static let shortDramaHistoryDidChange = Notification.Name("bbchat.shortDrama.historyDidChange")
}
