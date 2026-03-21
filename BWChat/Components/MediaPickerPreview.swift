// BWChat/Components/MediaPickerPreview.swift
// Media preview sheet for multi-select image/video sending

import SwiftUI
import AVFoundation

// MARK: - Prepared Media Item

struct PreparedMediaItem: Identifiable {
    let id = UUID()
    let type: MediaType
    let data: Data
    let thumbnail: UIImage?
    let filename: String

    enum MediaType {
        case image, video
    }
}

// MARK: - Media Preview Sheet

struct MediaPickerPreview: View {
    @Binding var mediaItems: [PreparedMediaItem]
    let onSend: ([PreparedMediaItem]) -> Void
    @Environment(\.dismiss) private var dismiss

    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(mediaItems) { item in
                            MediaThumbnailCell(item: item) {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    mediaItems.removeAll { $0.id == item.id }
                                    if mediaItems.isEmpty {
                                        dismiss()
                                    }
                                }
                            }
                        }
                    }
                    .padding(16)
                }

                Divider().opacity(0.3)

                // Bottom send bar
                HStack {
                    Text("\(mediaItems.count) 项已选择")
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)

                    Spacer()

                    Button {
                        let items = mediaItems
                        dismiss()
                        onSend(items)
                    } label: {
                        Text("发送 (\(mediaItems.count))")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 10)
                            .background(AppColors.accentGradient)
                            .cornerRadius(20)
                    }
                    .disabled(mediaItems.isEmpty)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(AppColors.secondaryBackground)
            }
            .background(AppColors.background)
            .navigationTitle("预览")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                    .foregroundColor(AppColors.accent)
                }
            }
        }
    }
}

// MARK: - Thumbnail Cell

private struct MediaThumbnailCell: View {
    let item: PreparedMediaItem
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let thumbnail = item.thumbnail {
                Image(uiImage: thumbnail)
                    .resizable()
                    .scaledToFill()
                    .frame(minWidth: 0, maxWidth: .infinity)
                    .aspectRatio(1, contentMode: .fill)
                    .clipped()
                    .cornerRadius(10)
            } else {
                RoundedRectangle(cornerRadius: 10)
                    .fill(AppColors.separator)
                    .aspectRatio(1, contentMode: .fill)
                    .overlay(
                        Image(systemName: item.type == .video ? "video.fill" : "photo")
                            .font(.title2)
                            .foregroundColor(AppColors.secondaryText)
                    )
            }

            // Video badge
            if item.type == .video {
                Image(systemName: "video.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color.black.opacity(0.6))
                    .cornerRadius(4)
                    .padding(6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            }

            // Remove button
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 22))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Color.black.opacity(0.6))
            }
            .padding(4)
        }
    }
}

// MARK: - Video Thumbnail Helper

func generateVideoThumbnail(from url: URL) -> UIImage? {
    let asset = AVURLAsset(url: url)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 300, height: 300)
    if let cgImage = try? generator.copyCGImage(at: .zero, actualTime: nil) {
        return UIImage(cgImage: cgImage)
    }
    return nil
}
