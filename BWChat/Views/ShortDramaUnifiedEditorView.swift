import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

enum ShortDramaUnifiedEditorMode {
    case create
    case edit(ShortDramaSeries)

    var series: ShortDramaSeries? {
        if case .edit(let series) = self { return series }
        return nil
    }
}

private enum ShortDramaEditorField: Hashable {
    case title
    case intro
}

struct ShortDramaUnifiedEditorView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var workingSeries: ShortDramaSeries?
    @State private var title: String
    @State private var intro: String
    @State private var coverSelection: PhotosPickerItem?
    @State private var coverImage: UIImage?
    @State private var coverData: Data?
    @State private var episodeSelections: [PhotosPickerItem] = []
    @State private var episodes: [ShortDramaEpisodeDraft]
    @State private var editingEpisode: ShortDramaEpisodeDraft?
    @State private var isPublishing = false
    @State private var toastMessage: String?
    @FocusState private var focusedField: ShortDramaEditorField?

    let onSaved: (ShortDramaSeries) -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 5)
    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedIntro: String { intro.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canPublish: Bool {
        let numbers = episodes.map(\.episodeNumber)
        return !trimmedTitle.isEmpty
            && !episodes.isEmpty
            && episodes.allSatisfy { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            && numbers.allSatisfy { $0 > 0 }
            && Set(numbers).count == numbers.count
            && (workingSeries != nil || coverData != nil)
            && !isPublishing
    }

    init(mode: ShortDramaUnifiedEditorMode, onSaved: @escaping (ShortDramaSeries) -> Void = { _ in }) {
        let series = mode.series
        let normalizedEpisodes = (series?.episodes ?? [])
            .sorted {
                let lhs = $0.episodeNumber ?? Int.max
                let rhs = $1.episodeNumber ?? Int.max
                return lhs == rhs ? $0.id < $1.id : lhs < rhs
            }
            .enumerated()
            .map { index, video in
                var draft = ShortDramaEpisodeDraft(video: video)
                let normalizedNumber = index + 1
                if draft.episodeNumber != normalizedNumber {
                    draft.episodeNumber = normalizedNumber
                    draft.isDirty = true
                }
                return draft
            }
        _workingSeries = State(initialValue: series)
        _title = State(initialValue: series?.title ?? "")
        _intro = State(initialValue: series?.intro ?? "")
        _episodes = State(initialValue: normalizedEpisodes)
        self.onSaved = onSaved
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                ShortDramaEditorSeriesCard(
                    coverURL: workingSeries?.coverURL ?? "",
                    coverImage: coverImage,
                    coverSelection: $coverSelection,
                    title: $title,
                    intro: $intro,
                    focusedField: $focusedField
                )

                ShortDramaEditorEpisodeGrid(
                    episodes: episodes,
                    columns: columns,
                    selections: $episodeSelections,
                    onEdit: { editingEpisode = $0 }
                )
            }
            .padding(16)
            .padding(.bottom, 96)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(workingSeries == nil ? L10n.tr("shortDrama.series.create") : L10n.tr("shortDrama.series.edit"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton { navigator.pop() }
            }
        }
        .safeAreaInset(edge: .bottom) {
            ShortDramaPublishBar(isPublishing: isPublishing, isEnabled: canPublish, action: publish)
        }
        .onChange(of: coverSelection) { item in
            Task { await loadCover(item) }
        }
        .onChange(of: episodeSelections) { items in
            guard !items.isEmpty else { return }
            episodeSelections = []
            Task { await importEpisodes(items) }
        }
        .sheet(item: $editingEpisode) { episode in
            ShortDramaEpisodeEditorSheet(
                episode: episode,
                onSave: updateEpisode,
                onDelete: deleteEpisode
            )
            .presentationDetents([.large])
        }
        .toast(message: $toastMessage)
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .background(
            KeyboardDismissTapInstaller(
                isEnabled: focusedField != nil,
                consumesOutsideTaps: false,
                onBackgroundTap: dismissEditorInputState
            )
        )
        .onDisappear {
            dismissEditorInputState()
        }
    }

    private func dismissEditorInputState() {
        focusedField = nil
        hideKeyboard()
    }

    private func loadCover(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else { return }
        let compressed = APIService.compressImageForUpload(data, maxDimension: 1280, quality: 0.78, maxBytes: 900_000)
        await MainActor.run {
            coverData = compressed
            coverImage = UIImage(data: compressed) ?? image
        }
    }

    private func importEpisodes(_ items: [PhotosPickerItem]) async {
        let available = max(0, 20 - episodes.filter { $0.localVideoURL != nil }.count)
        guard available > 0 else {
            toastMessage = L10n.tr("shortDrama.upload.limit", 20)
            return
        }

        let selectedItems = Array(items.prefix(available))
        let prepared = await withTaskGroup(of: ShortDramaPreparedEpisode?.self) { group in
            for (index, item) in selectedItems.enumerated() {
                group.addTask {
                    await Self.prepareEpisode(item, selectionIndex: index)
                }
            }

            var results: [ShortDramaPreparedEpisode] = []
            for await result in group {
                if let result { results.append(result) }
            }
            return results.sorted { $0.selectionIndex < $1.selectionIndex }
        }

        guard !Task.isCancelled else {
            prepared.forEach { try? FileManager.default.removeItem(at: $0.localURL) }
            return
        }

        let firstNumber = episodes.count + 1
        let drafts = prepared.enumerated().map { offset, item in
            let episodeNumber = firstNumber + offset
            return ShortDramaEpisodeDraft(
                episodeNumber: episodeNumber,
                title: L10n.tr("shortDrama.episode", episodeNumber),
                intro: "",
                unlockPriceCatFood: 0,
                localVideoURL: item.localURL,
                previewImage: item.previewImage
            )
        }
        episodes.append(contentsOf: drafts)
    }

    private static func prepareEpisode(
        _ item: PhotosPickerItem,
        selectionIndex: Int
    ) async -> ShortDramaPreparedEpisode? {
        guard let transfer = try? await item.loadTransferable(type: VideoTransferable.self) else { return nil }
        let targetURL = persistedDraftURL(source: transfer.url)
        do {
            try FileManager.default.copyItem(at: transfer.url, to: targetURL)
        } catch {
            try? FileManager.default.removeItem(at: transfer.url)
            return nil
        }
        let preview = await previewImage(for: targetURL)
        try? FileManager.default.removeItem(at: transfer.url)
        return ShortDramaPreparedEpisode(
            selectionIndex: selectionIndex,
            localURL: targetURL,
            previewImage: preview
        )
    }

    private func renumberEpisodes() {
        episodes.sort { ($0.episodeNumber, $0.id.uuidString) < ($1.episodeNumber, $1.id.uuidString) }
        for index in episodes.indices {
            let expectedNumber = index + 1
            let previousNumber = episodes[index].episodeNumber
            guard previousNumber != expectedNumber else { continue }
            let usesDefaultTitle = episodes[index].title == L10n.tr("shortDrama.episode", previousNumber)
            episodes[index].episodeNumber = expectedNumber
            episodes[index].isDirty = episodes[index].serverVideo != nil || episodes[index].isDirty
            if usesDefaultTitle {
                episodes[index].title = L10n.tr("shortDrama.episode", expectedNumber)
            }
        }
    }

    private func updateEpisode(_ updated: ShortDramaEpisodeDraft) {
        guard let index = episodes.firstIndex(where: { $0.id == updated.id }) else { return }
        var next = updated
        next.isDirty = updated.metadataDiffers(from: episodes[index]) || episodes[index].isDirty
        episodes[index] = next
        episodes.sort { ($0.episodeNumber, $0.id.uuidString) < ($1.episodeNumber, $1.id.uuidString) }
    }

    private func deleteEpisode(_ episode: ShortDramaEpisodeDraft) {
        editingEpisode = nil
        if let url = episode.localVideoURL {
            try? FileManager.default.removeItem(at: url)
        }
        episodes.removeAll { $0.id == episode.id }
        renumberEpisodes()
        notifySeriesSnapshot()
        guard let videoID = episode.serverVideo?.id else { return }
        Task {
            do {
                try await APIService.shared.deleteShortDramaEpisode(videoID: videoID)
            } catch {
                toastMessage = error.localizedDescription
                if !episodes.contains(where: { $0.id == episode.id }) {
                    episodes.append(episode)
                    renumberEpisodes()
                    notifySeriesSnapshot()
                }
            }
        }
    }

    private func publish() {
        guard canPublish else { return }
        isPublishing = true
        let uploadID = "short-drama-\(workingSeries?.id ?? UUID().uuidString)"
        BackgroundUploadCoordinator.shared.enqueue(id: uploadID) {
            await publishAsync()
        }
        // Publishing belongs to the app-wide upload coordinator. Returning now keeps
        // navigation responsive while metadata and episode media continue uploading.
        navigator.pop()
    }

    private func publishAsync() async {
        defer { isPublishing = false }
        do {
            let series = try await saveSeriesMetadata()
            workingSeries = series
            onSaved(series)

            for index in episodes.indices {
                if episodes[index].serverVideo != nil {
                    try await updateExistingEpisode(at: index)
                } else {
                    try await uploadDraftEpisode(at: index, seriesID: series.id)
                }
            }

            let submitted = try await APIService.shared.submitShortDramaSeries(seriesID: series.id)
            workingSeries = submitted
            onSaved(submitted)
            toastMessage = L10n.tr("shortDrama.publish.submitted")
        } catch {
            toastMessage = error.localizedDescription
        }
    }

    private func saveSeriesMetadata() async throws -> ShortDramaSeries {
        if let series = workingSeries {
            return try await APIService.shared.updateShortDramaSeries(
                seriesID: series.id,
                title: trimmedTitle,
                intro: trimmedIntro,
                coverData: coverData,
                coverFilename: coverData == nil ? nil : Self.coverFilename()
            )
        }
        guard let coverData else {
            throw ShortDramaEditorError.missingCover
        }
        return try await APIService.shared.createShortDramaSeries(
            title: trimmedTitle,
            intro: trimmedIntro,
            coverData: coverData,
            coverFilename: Self.coverFilename()
        )
    }

    private func updateExistingEpisode(at index: Int) async throws {
        guard episodes.indices.contains(index),
              episodes[index].isDirty,
              let videoID = episodes[index].serverVideo?.id else { return }
        episodes[index].uploadState = .uploading
        do {
            let video = try await APIService.shared.updateShortDramaEpisode(
                videoID: videoID,
                title: episodes[index].title,
                intro: episodes[index].intro,
                episodeNumber: episodes[index].episodeNumber,
                unlockPriceCatFood: episodes[index].unlockPriceCatFood
            )
            episodes[index].serverVideo = video
            episodes[index].uploadState = .uploaded
            episodes[index].isDirty = false
        } catch {
            episodes[index].uploadState = .failed
            throw error
        }
    }

    private func uploadDraftEpisode(at index: Int, seriesID: String) async throws {
        guard episodes.indices.contains(index), let url = episodes[index].localVideoURL else { return }
        episodes[index].uploadState = .uploading
        do {
            let videoData = try await Task.detached(priority: .utility) { try Data(contentsOf: url) }.value
            let preview: UIImage?
            if let existingPreview = episodes[index].previewImage {
                preview = existingPreview
            } else {
                preview = await Self.previewImage(for: url)
            }
            guard let coverData = preview?.jpegData(compressionQuality: 0.82) else {
                throw ShortDramaEditorError.previewGenerationFailed
            }
            let result = try await APIService.shared.uploadShortDramaEpisode(
                seriesID: seriesID,
                title: episodes[index].title,
                intro: episodes[index].intro,
                episodeNumber: episodes[index].episodeNumber,
                videoData: videoData,
                videoFilename: Self.videoFilename(for: url),
                coverData: coverData,
                coverFilename: Self.episodeCoverFilename(),
                unlockPriceCatFood: episodes[index].unlockPriceCatFood
            )
            episodes[index].serverVideo = result.video
            episodes[index].uploadState = .uploaded
            episodes[index].isDirty = false
            try? FileManager.default.removeItem(at: url)
            episodes[index].localVideoURL = nil
        } catch {
            episodes[index].uploadState = .failed
            throw error
        }
    }

    private static func persistedDraftURL(source: URL) -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let directory = root.appendingPathComponent("ShortDramaDrafts", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = source.pathExtension.isBlank ? "mp4" : source.pathExtension
        return directory.appendingPathComponent("\(UUID().uuidString).\(ext)")
    }

    private static func previewImage(for url: URL) async -> UIImage? {
        await Task.detached(priority: .utility) {
            let generator = AVAssetImageGenerator(asset: AVAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 720, height: 720)
            guard let image = try? generator.copyCGImage(at: .zero, actualTime: nil) else { return nil }
            return UIImage(cgImage: image)
        }.value
    }

    private static func coverFilename() -> String { "short_drama_cover_\(Int(Date().timeIntervalSince1970)).jpg" }
    private static func episodeCoverFilename() -> String { "short_drama_episode_cover_\(UUID().uuidString).jpg" }
    private static func videoFilename(for url: URL) -> String {
        "short_drama_episode_\(UUID().uuidString).\(url.pathExtension.isBlank ? "mp4" : url.pathExtension.lowercased())"
    }

    private func notifySeriesSnapshot() {
        guard let series = workingSeries else { return }
        let serverEpisodes = episodes.compactMap(\.serverVideo)
        let snapshot = ShortDramaSeries(
            seriesID: series.id,
            title: series.title,
            intro: series.intro,
            coverURL: series.coverURL,
            episodeCount: serverEpisodes.count,
            status: series.status,
            statusMessage: series.statusMessage,
            updatedAt: series.updatedAt,
            episodes: serverEpisodes,
            creator: series.creator,
            resumeEpisodeID: series.resumeEpisodeID,
            resumePositionSeconds: series.resumePositionSeconds,
            lastWatchedAt: series.lastWatchedAt
        )
        workingSeries = snapshot
        onSaved(snapshot)
    }
}

private struct ShortDramaEditorSeriesCard: View {
    let coverURL: String
    let coverImage: UIImage?
    @Binding var coverSelection: PhotosPickerItem?
    @Binding var title: String
    @Binding var intro: String
    @FocusState.Binding var focusedField: ShortDramaEditorField?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.tr("shortDrama.series.title"))
                    .font(.caption.weight(.bold))
                    .foregroundColor(.black)

                TextField(L10n.tr("shortDrama.series.title.placeholder"), text: $title)
                    .font(.headline.weight(.bold))
                    .foregroundColor(AppColors.primaryText)
                    .focused($focusedField, equals: .title)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(AppColors.secondaryBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(
                                focusedField == .title ? AppColors.accent : AppColors.separator.opacity(0.55),
                                lineWidth: focusedField == .title ? 1.5 : 1
                            )
                    )
            }

            Text(L10n.tr("shortDrama.series.poster"))
                .font(.caption.weight(.bold))
                .foregroundColor(.black)

            PhotosPicker(selection: $coverSelection, matching: .images) {
                ZStack(alignment: .bottomTrailing) {
                    ShortDramaPosterView(
                        url: coverURL,
                        image: coverImage,
                        placeholderColors: [Color.black, AppColors.iconYellow]
                    )

                    Label(
                        L10n.tr(coverURL.isBlank && coverImage == nil ? "shortDrama.cover.choose" : "shortDrama.cover.replace"),
                        systemImage: "photo"
                    )
                        .font(.caption.weight(.bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Color.black.opacity(0.55))
                        .clipShape(Capsule())
                        .padding(10)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 131)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.tr("shortDrama.series.intro"))
                    .font(.caption.weight(.bold))
                    .foregroundColor(.black)

                TextField(L10n.tr("shortDrama.series.intro.placeholder"), text: $intro, axis: .vertical)
                    .font(.subheadline)
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(3...5)
                    .focused($focusedField, equals: .intro)
                    .padding(12)
                    .frame(maxWidth: .infinity, minHeight: 76, alignment: .topLeading)
                    .background(AppColors.secondaryBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(
                                focusedField == .intro ? AppColors.accent : AppColors.separator.opacity(0.55),
                                lineWidth: focusedField == .intro ? 1.5 : 1
                            )
                    )
            }
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
    }
}

private struct ShortDramaEditorEpisodeGrid: View {
    let episodes: [ShortDramaEpisodeDraft]
    let columns: [GridItem]
    @Binding var selections: [PhotosPickerItem]
    let onEdit: (ShortDramaEpisodeDraft) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.tr("shortDrama.episode.list"))
                .font(.subheadline.weight(.bold))
                .foregroundColor(AppColors.primaryText)

            Divider()
                .opacity(0.5)

            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(episodes) { episode in
                    Button { onEdit(episode) } label: {
                        ShortDramaDraftEpisodeSquare(episode: episode)
                    }
                    .buttonStyle(.plain)
                }

                PhotosPicker(selection: $selections, maxSelectionCount: 20, matching: .videos) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(AppColors.secondaryBackground)
                        .overlay(
                            Image(systemName: "plus")
                                .font(.headline.weight(.bold))
                                .foregroundColor(AppColors.accent)
                        )
                        .frame(height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("shortDrama.episode.upload"))
            }
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
    }
}

private struct ShortDramaDraftEpisodeSquare: View {
    let episode: ShortDramaEpisodeDraft

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColors.secondaryBackground)
            if let preview = episode.previewImage {
                Image(uiImage: preview).resizable().scaledToFill()
            } else {
                Text("\(episode.episodeNumber)")
                    .font(.subheadline.weight(.bold))
                    .foregroundColor(AppColors.primaryText)
            }
            VStack {
                HStack {
                    if episode.unlockPriceCatFood > 0 {
                        HStack(spacing: 2) {
                            Image(systemName: "pawprint.fill")
                            Text("\(episode.unlockPriceCatFood)")
                        }
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(.white)
                    }
                    Spacer()
                    ShortDramaUploadStateMark(state: episode.uploadState)
                }
                Spacer()
                Text("\(episode.episodeNumber)")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color.black.opacity(0.55))
                    .clipShape(Capsule())
            }
            .padding(5)
        }
        .frame(height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct ShortDramaUploadStateMark: View {
    let state: ShortDramaEpisodeUploadState

    var body: some View {
        Group {
            switch state {
            case .pending: EmptyView()
            case .uploading: ProgressView().tint(.white).scaleEffect(0.6)
            case .uploaded: Image(systemName: "checkmark.circle.fill").foregroundColor(AppColors.online)
            case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundColor(AppColors.errorColor)
            }
        }
        .font(.system(size: 12, weight: .bold))
    }
}

private struct ShortDramaEpisodeEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ShortDramaEpisodeDraft
    @State private var priceText: String

    let onSave: (ShortDramaEpisodeDraft) -> Void
    let onDelete: (ShortDramaEpisodeDraft) -> Void

    init(
        episode: ShortDramaEpisodeDraft,
        onSave: @escaping (ShortDramaEpisodeDraft) -> Void,
        onDelete: @escaping (ShortDramaEpisodeDraft) -> Void
    ) {
        _draft = State(initialValue: episode)
        _priceText = State(initialValue: "\(episode.unlockPriceCatFood)")
        self.onSave = onSave
        self.onDelete = onDelete
    }

    var body: some View {
        NavigationView {
            Form {
                Section {
                    HStack {
                        Text(L10n.tr("shortDrama.episode.catFoodSetting"))
                        Spacer()
                        TextField("0", text: $priceText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 70)
                        Text(L10n.tr("wallet.currency.catFood"))
                            .foregroundColor(AppColors.secondaryText)
                    }
                } footer: {
                    Text("0–100")
                }

                Section {
                    TextField(L10n.tr("shortDrama.episode.title.placeholder"), text: $draft.title)
                    TextField(L10n.tr("shortDrama.episode.intro.placeholder"), text: $draft.intro, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section {
                    Button(role: .destructive) {
                        onDelete(draft)
                        dismiss()
                    } label: {
                        Text(L10n.tr("shortDrama.episode.delete"))
                    }
                }
            }
            .onChange(of: priceText) { value in
                let digits = value.filter(\.isNumber)
                guard !digits.isEmpty else {
                    if !value.isEmpty { priceText = "" }
                    return
                }
                let normalized = String(min(Int(digits) ?? 0, 100))
                if priceText != normalized { priceText = normalized }
            }
            .navigationTitle(draft.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.tr("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.tr("common.save"), action: save)
                }
            }
        }
    }

    private func save() {
        draft.unlockPriceCatFood = min(max(Int(priceText) ?? 0, 0), 100)
        draft.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.intro = draft.intro.trimmingCharacters(in: .whitespacesAndNewlines)
        onSave(draft)
        dismiss()
    }
}

private struct ShortDramaPublishBar: View {
    let isPublishing: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            Button(action: action) {
                Group {
                    if isPublishing {
                        ProgressView().tint(.white)
                    } else {
                        Text(L10n.tr("common.publish")).font(.headline.weight(.bold))
                    }
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(isEnabled ? AppColors.accent : AppColors.tertiaryText)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(!isEnabled)
            Text(L10n.tr("shortDrama.publish.reviewHint"))
                .font(.caption)
                .foregroundColor(AppColors.secondaryText)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
    }
}

struct ShortDramaEpisodeDraft: Identifiable, Equatable {
    let id: UUID
    var episodeNumber: Int
    var title: String
    var intro: String
    var unlockPriceCatFood: Int
    var localVideoURL: URL?
    var previewImage: UIImage?
    var serverVideo: ShortDramaVideo?
    var uploadState: ShortDramaEpisodeUploadState
    var isDirty: Bool

    init(
        id: UUID = UUID(),
        episodeNumber: Int,
        title: String,
        intro: String,
        unlockPriceCatFood: Int,
        localVideoURL: URL?,
        previewImage: UIImage?,
        serverVideo: ShortDramaVideo? = nil,
        uploadState: ShortDramaEpisodeUploadState = .pending,
        isDirty: Bool = false
    ) {
        self.id = id
        self.episodeNumber = episodeNumber
        self.title = title
        self.intro = intro
        self.unlockPriceCatFood = unlockPriceCatFood
        self.localVideoURL = localVideoURL
        self.previewImage = previewImage
        self.serverVideo = serverVideo
        self.uploadState = uploadState
        self.isDirty = isDirty
    }

    init(video: ShortDramaVideo) {
        self.init(
            episodeNumber: video.episodeNumber ?? 1,
            title: video.displayTitle,
            intro: video.intro,
            unlockPriceCatFood: video.unlockPriceCatFood ?? 0,
            localVideoURL: nil,
            previewImage: nil,
            serverVideo: video,
            uploadState: .uploaded
        )
    }

    func metadataDiffers(from other: ShortDramaEpisodeDraft) -> Bool {
        episodeNumber != other.episodeNumber
            || title != other.title
            || intro != other.intro
            || unlockPriceCatFood != other.unlockPriceCatFood
    }
}

private struct ShortDramaPreparedEpisode: @unchecked Sendable {
    let selectionIndex: Int
    let localURL: URL
    let previewImage: UIImage?
}

enum ShortDramaEpisodeUploadState: Equatable {
    case pending
    case uploading
    case uploaded
    case failed
}

private enum ShortDramaEditorError: LocalizedError {
    case missingCover
    case previewGenerationFailed

    var errorDescription: String? {
        switch self {
        case .missingCover: return L10n.tr("shortDrama.cover.required")
        case .previewGenerationFailed: return L10n.tr("shortDrama.video.previewFailed")
        }
    }
}
