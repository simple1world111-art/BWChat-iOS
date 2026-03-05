// BWChat/Views/ImagePreviewView.swift
// Full-screen image preview with zoom and pan

import SwiftUI

struct ImagePreviewView: View {
    let imageURL: String
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var isLoading = true
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack {
            // Background
            Color.black.ignoresSafeArea()

            // Image
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                scale = lastScale * value
                            }
                            .onEnded { _ in
                                lastScale = scale
                                if scale < 1 {
                                    withAnimation {
                                        scale = 1
                                        lastScale = 1
                                    }
                                }
                            }
                    )
                    .simultaneousGesture(
                        DragGesture()
                            .onChanged { value in
                                offset = CGSize(
                                    width: lastOffset.width + value.translation.width,
                                    height: lastOffset.height + value.translation.height
                                )
                            }
                            .onEnded { value in
                                lastOffset = offset
                                // Dismiss on swipe down
                                if value.translation.height > 150 && scale <= 1.1 {
                                    dismiss()
                                }
                            }
                    )
                    .onTapGesture(count: 2) {
                        withAnimation {
                            if scale > 1 {
                                scale = 1
                                lastScale = 1
                                offset = .zero
                                lastOffset = .zero
                            } else {
                                scale = 2.5
                                lastScale = 2.5
                            }
                        }
                    }
            } else if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
            } else {
                Image(systemName: "photo")
                    .font(.system(size: 48))
                    .foregroundColor(.gray)
            }

            // Close and save buttons
            VStack {
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .padding()
                }

                Spacer()

                if image != nil {
                    HStack {
                        Spacer()
                        Button {
                            saveToPhotoLibrary()
                        } label: {
                            Image(systemName: "square.and.arrow.down")
                                .font(.system(size: 20))
                                .foregroundColor(.white)
                                .padding(12)
                                .background(.ultraThinMaterial)
                                .cornerRadius(10)
                        }
                        .padding()
                    }
                }
            }
        }
        .task {
            image = await ImageCacheManager.shared.loadImage(from: imageURL)
            isLoading = false
        }
    }

    private func saveToPhotoLibrary() {
        guard let image = image else { return }
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
    }
}
