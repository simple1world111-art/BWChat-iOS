// BWChat/Views/ImagePreviewView.swift
// Full-screen image preview with pinch zoom and dismiss gesture

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
    @State private var dragOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black
                    .ignoresSafeArea()
                    .opacity(dismissOpacity)

                if let image = image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .scaleEffect(scale)
                        .offset(x: offset.width, y: offset.height + dragOffset.height)
                        .gesture(pinchGesture)
                        .gesture(scale <= 1.05 ? dismissDragGesture : nil)
                        .simultaneousGesture(scale > 1.05 ? panGesture : nil)
                        .onTapGesture(count: 2) { doubleTap() }
                        .onTapGesture { dismiss() }
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
                        Button { dismiss() } label: {
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
                            Button { saveToPhotoLibrary() } label: {
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
                .opacity(scale <= 1.05 && dragOffset.height == 0 ? 1 : 0)
            }
        }
        .statusBarHidden(true)
        .task {
            image = await ImageCacheManager.shared.loadImage(from: imageURL)
            isLoading = false
        }
    }

    // MARK: - Gestures

    private var dismissOpacity: Double {
        let progress = min(abs(dragOffset.height) / 300, 1)
        return 1 - progress * 0.5
    }

    /// Drag down to dismiss (only at scale ~1)
    private var dismissDragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                dragOffset = value.translation
            }
            .onEnded { value in
                if abs(value.translation.height) > 120 {
                    dismiss()
                } else {
                    withAnimation(.easeOut(duration: 0.2)) {
                        dragOffset = .zero
                    }
                }
            }
    }

    /// Pinch to zoom
    private var pinchGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                scale = max(lastScale * value, 0.5)
            }
            .onEnded { _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    if scale < 1 {
                        scale = 1
                        offset = .zero
                        lastOffset = .zero
                    }
                }
                lastScale = scale
            }
    }

    /// Pan when zoomed in
    private var panGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                lastOffset = offset
            }
    }

    private func doubleTap() {
        withAnimation(.easeInOut(duration: 0.25)) {
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

    private func saveToPhotoLibrary() {
        guard let image = image else { return }
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
    }
}
