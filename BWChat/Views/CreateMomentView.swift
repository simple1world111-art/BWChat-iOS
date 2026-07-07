import AVFoundation
import SwiftUI
import PhotosUI
import UIKit
import UniformTypeIdentifiers

private struct MomentDraftMedia: Identifiable, @unchecked Sendable {
    enum Kind: Sendable {
        case image
        case video

        var uploadKind: MomentUploadMedia.Kind {
            switch self {
            case .image: return .image
            case .video: return .video
            }
        }
    }

    let id = UUID()
    let kind: Kind
    let data: Data
    let filename: String
    let mimeType: String
    let previewImage: UIImage?

    var uploadMedia: MomentUploadMedia {
        MomentUploadMedia(
            kind: kind.uploadKind,
            data: data,
            filename: filename,
            mimeType: mimeType,
            previewImageData: previewImage?.jpegData(compressionQuality: 0.82)
        )
    }
}

struct CreateMomentView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var content = ""
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var selectedMedia: [MomentDraftMedia] = []
    @State private var unlockPriceCatFood: Int?
    @State private var showUnlockOptions = false
    @State private var isPublishing = false
    @State private var toastMessage: String?
    @FocusState private var isContentFocused: Bool

    private let maxContentLength = 200
    private let maxMediaCount = 9
    private let unlockPrices = [10, 50, 100, 200, 500, 1000]

    var onPublish: (String, [MomentUploadMedia], Int?) -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 0) {
                        composerCard
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 24)
                }
                .scrollDismissesKeyboard(.immediately)
                .background(
                    AppColors.secondaryBackground
                        .contentShape(Rectangle())
                        .onTapGesture {
                            dismissContentFocus()
                        }
                )
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle(L10n.tr("moment.create.title"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(Color(hex: "F7F7F7"), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.light, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    AppBackButton {
                        dismissContentFocus()
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        dismissContentFocus()
                        publish()
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(canPublish ? AppColors.accent : AppColors.tertiaryText)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!canPublish || isPublishing)
                    .opacity(canPublish && !isPublishing ? 1 : 0.72)
                    .accessibilityLabel(L10n.tr("common.publish"))
                }
            }
            .confirmationDialog(
                L10n.tr("moment.catFoodUnlock"),
                isPresented: $showUnlockOptions,
                titleVisibility: .visible
            ) {
                Button(L10n.tr("moment.unlock.none")) {
                    unlockPriceCatFood = nil
                }
                ForEach(unlockPrices, id: \.self) { price in
                    Button(L10n.tr("moment.unlock.price", price)) {
                        unlockPriceCatFood = price
                    }
                }
                Button(L10n.tr("common.cancel"), role: .cancel) { }
            }
            .toast(message: $toastMessage)
        }
    }

    private var composerCard: some View {
        VStack(spacing: 0) {
            textInputSection

            Divider()
                .background(AppColors.separator.opacity(0.65))

            mediaSection
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 22)
                .contentShape(Rectangle())
                .onTapGesture {
                    dismissContentFocus()
                }

            Divider()
                .background(AppColors.separator.opacity(0.65))

            settingsSection
        }
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppColors.separator.opacity(0.8), lineWidth: 1)
        )
    }

    private var textInputSection: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $content)
                .font(.system(size: 16))
                .foregroundColor(AppColors.primaryText)
                .frame(height: 190)
                .padding(.horizontal, 22)
                .padding(.top, 18)
                .padding(.bottom, 28)
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .focused($isContentFocused)
                .onChange(of: content) { value in
                    guard value.count > maxContentLength else { return }
                    content = String(value.prefix(maxContentLength))
                }

            if content.isEmpty {
                Text(L10n.tr("moment.content.placeholder"))
                    .font(.system(size: 16))
                    .foregroundColor(AppColors.tertiaryText)
                    .padding(.horizontal, 26)
                    .padding(.top, 26)
                    .allowsHitTesting(false)
            }

            VStack {
                Spacer()
                HStack {
                    Spacer()
                    Text("\(content.count)/\(maxContentLength)")
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                        .padding(.trailing, 20)
                        .padding(.bottom, 14)
                }
            }
        }
    }

    private var mediaSection: some View {
        LazyVGrid(columns: mediaColumns, alignment: .leading, spacing: 10) {
            ForEach(selectedMedia) { media in
                mediaPreviewCell(media)
            }

            if selectedMedia.count < maxMediaCount {
                PhotosPicker(
                    selection: $selectedItems,
                    maxSelectionCount: max(1, maxMediaCount - selectedMedia.count),
                    matching: .any(of: [.images, .videos])
                ) {
                    addMediaTile
                }
                .buttonStyle(.plain)
                .onChange(of: selectedItems) { items in
                    Task { await loadSelectedMedia(items) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var mediaColumns: [GridItem] {
        Array(repeating: GridItem(.fixed(mediaTileSize), spacing: 10), count: 3)
    }

    private var mediaTileSize: CGFloat {
        min(96, floor((UIScreen.main.bounds.width - 32 - 36 - 20) / 3))
    }

    private var addMediaTile: some View {
        VStack(spacing: 9) {
            Image(systemName: "camera.fill")
                .font(.system(size: 28))
                .foregroundColor(AppColors.primaryText)
            Text(L10n.tr("moment.addMedia"))
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(width: mediaTileSize, height: mediaTileSize)
        .background(Color(hex: "F7F7F7"))
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private func mediaPreviewCell(_ media: MomentDraftMedia) -> some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let previewImage = media.previewImage {
                    Image(uiImage: previewImage)
                        .resizable()
                        .scaledToFill()
                } else {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color(hex: "ECEEF4"))
                        .overlay(
                            Image(systemName: media.kind == .video ? "video.fill" : "photo")
                                .font(.system(size: 24))
                                .foregroundColor(AppColors.secondaryText)
                        )
                }
            }
            .frame(width: mediaTileSize, height: mediaTileSize)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

            if media.kind == .video {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 25))
                    .foregroundColor(.white)
                    .shadow(color: .black.opacity(0.35), radius: 4, x: 0, y: 1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }

            Button {
                dismissContentFocus()
                selectedMedia.removeAll { $0.id == media.id }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .shadow(color: .black.opacity(0.3), radius: 3, x: 0, y: 1)
            }
            .offset(x: 7, y: -7)
        }
        .frame(width: mediaTileSize, height: mediaTileSize)
    }

    private var settingsSection: some View {
        VStack(spacing: 0) {
            settingRow(
                icon: "takeoutbag.and.cup.and.straw.fill",
                title: L10n.tr("moment.catFoodUnlock"),
                value: unlockPriceCatFood.map { L10n.tr("moment.unlock.price", $0) } ?? L10n.tr("moment.unlock.none")
            ) {
                showUnlockOptions = true
            }
        }
    }

    private func settingRow(icon: String, title: String, value: String, action: @escaping () -> Void) -> some View {
        Button {
            dismissContentFocus()
            action()
        } label: {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.system(size: 21, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                    .frame(width: 22)

                Text(title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)

                Spacer(minLength: 12)

                Text(value)
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.tertiaryText)
                    .lineLimit(1)

                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
            }
            .frame(height: 64)
            .padding(.horizontal, 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var canPublish: Bool {
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !selectedMedia.isEmpty
    }

    private func publish() {
        guard canPublish, !isPublishing else { return }
        isPublishing = true
        let trimmedContent = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let uploads = selectedMedia.map(\.uploadMedia)
        let price = selectedMedia.isEmpty ? nil : unlockPriceCatFood

        onPublish(trimmedContent, uploads, price)
        dismiss()
    }

    private func dismissContentFocus() {
        isContentFocused = false
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
    }

    private func loadSelectedMedia(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        var loaded: [MomentDraftMedia] = []
        let remaining = maxMediaCount - selectedMedia.count

        for (index, item) in items.prefix(remaining).enumerated() {
            if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }),
               let video = try? await item.loadTransferable(type: VideoTransferable.self),
               let videoData = await videoData(for: video.url) {
                let filename = videoFilename(for: video.url, offset: index)
                loaded.append(
                    MomentDraftMedia(
                        kind: .video,
                        data: videoData,
                        filename: filename,
                        mimeType: mimeType(for: filename, fallback: "video/mp4"),
                        previewImage: await videoPreviewImage(for: video.url)
                    )
                )
                try? FileManager.default.removeItem(at: video.url)
                continue
            }

            if let data = try? await item.loadTransferable(type: Data.self),
               let media = await imageDraftMedia(from: data, offset: index) {
                loaded.append(media)
            }
        }

        await MainActor.run {
            selectedMedia.append(contentsOf: loaded.prefix(maxMediaCount - selectedMedia.count))
            selectedItems = []
        }
    }

    private func imageFilename(offset: Int) -> String {
        "moment_image_\(Int(Date().timeIntervalSince1970))_\(offset).jpg"
    }

    private func videoFilename(for url: URL, offset: Int) -> String {
        let ext = url.pathExtension.isEmpty ? "mp4" : url.pathExtension.lowercased()
        return "moment_video_\(Int(Date().timeIntervalSince1970))_\(offset).\(ext)"
    }

    private func mimeType(for filename: String, fallback: String) -> String {
        switch filename.lowercased().split(separator: ".").last {
        case "mov": return "video/quicktime"
        case "m4v": return "video/x-m4v"
        case "mp4": return "video/mp4"
        case "heic": return "image/heic"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        default: return fallback
        }
    }

    private func imageDraftMedia(from data: Data, offset: Int) async -> MomentDraftMedia? {
        let filename = imageFilename(offset: offset)

        return await Task.detached(priority: .utility) {
            let uploadData = APIService.compressImageForUpload(data)
            guard let image = UIImage(data: uploadData) ?? UIImage(data: data) else {
                return nil
            }
            return MomentDraftMedia(
                kind: .image,
                data: uploadData,
                filename: filename,
                mimeType: "image/jpeg",
                previewImage: Self.previewImage(from: image, maxDimension: 360)
            )
        }.value
    }

    private func videoData(for url: URL) async -> Data? {
        await Task.detached(priority: .utility) {
            try? Data(contentsOf: url)
        }.value
    }

    nonisolated private static func previewImage(from image: UIImage, maxDimension: CGFloat) -> UIImage {
        let width = image.size.width
        let height = image.size.height
        guard max(width, height) > maxDimension else { return image }

        let ratio = maxDimension / max(width, height)
        let newSize = CGSize(width: width * ratio, height: height * ratio)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }

    private func videoPreviewImage(for url: URL) async -> UIImage? {
        await Task.detached(priority: .utility) {
            let asset = AVAsset(url: url)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 320, height: 320)
            guard let cgImage = try? generator.copyCGImage(at: .zero, actualTime: nil) else {
                return nil
            }
            return UIImage(cgImage: cgImage)
        }.value
    }
}
