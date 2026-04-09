// BWChat/Views/ImagePreviewView.swift
// Full-screen image gallery with center-zoom transition, pinch zoom and swipe

import SwiftUI

struct ImageGalleryPreview: View {
    let imageURLs: [String]
    let initialIndex: Int
    @Environment(\.dismiss) private var dismiss
    @State private var currentIndex: Int
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var dragOffset: CGSize = .zero
    @State private var appearScale: CGFloat = 0.5
    @State private var appearOpacity: Double = 0

    init(imageURLs: [String], initialIndex: Int) {
        self.imageURLs = imageURLs
        self.initialIndex = initialIndex
        _currentIndex = State(initialValue: initialIndex)
    }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
                .opacity(dismissOpacity * appearOpacity)

            TabView(selection: $currentIndex) {
                ForEach(Array(imageURLs.enumerated()), id: \.offset) { index, url in
                    SingleImagePage(
                        imageURL: url,
                        isActive: index == currentIndex,
                        scale: index == currentIndex ? $scale : .constant(1),
                        lastScale: index == currentIndex ? $lastScale : .constant(1),
                        offset: index == currentIndex ? $offset : .constant(.zero),
                        lastOffset: index == currentIndex ? $lastOffset : .constant(.zero),
                        dragOffset: index == currentIndex ? $dragOffset : .constant(.zero),
                        onDismiss: { dismissWithAnimation() },
                        onSingleTap: { dismissWithAnimation() }
                    )
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: imageURLs.count > 1 ? .automatic : .never))
            .scaleEffect(appearScale)
            .opacity(appearOpacity)
            .onChange(of: currentIndex) { _ in
                scale = 1; lastScale = 1
                offset = .zero; lastOffset = .zero
                dragOffset = .zero
            }

            VStack {
                HStack {
                    if imageURLs.count > 1 {
                        Text("\(currentIndex + 1)/\(imageURLs.count)")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.ultraThinMaterial)
                            .cornerRadius(16)
                    }
                    Spacer()
                    Button { dismissWithAnimation() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundColor(.white.opacity(0.8))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer()

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
                    .padding(16)
                }
            }
            .opacity(scale <= 1.05 && dragOffset.height == 0 ? appearOpacity : 0)
        }
        .statusBarHidden(true)
        .onAppear {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                appearScale = 1.0
                appearOpacity = 1.0
            }
        }
    }

    private var dismissOpacity: Double {
        let progress = min(abs(dragOffset.height) / 300, 1)
        return 1 - progress * 0.5
    }

    private func dismissWithAnimation() {
        withAnimation(.easeOut(duration: 0.25)) {
            appearScale = 0.5
            appearOpacity = 0
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            dismiss()
        }
    }

    private func saveToPhotoLibrary() {
        Task {
            if let image = await ImageCacheManager.shared.loadImage(from: imageURLs[currentIndex]) {
                UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
            }
        }
    }
}

// MARK: - Single Image Page

private struct SingleImagePage: View {
    let imageURL: String
    let isActive: Bool
    @Binding var scale: CGFloat
    @Binding var lastScale: CGFloat
    @Binding var offset: CGSize
    @Binding var lastOffset: CGSize
    @Binding var dragOffset: CGSize
    var onDismiss: () -> Void
    var onSingleTap: () -> Void

    @State private var image: UIImage?
    @State private var isLoading = true

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.clear

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
                        .onTapGesture { onSingleTap() }
                } else if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Image(systemName: "photo")
                        .font(.system(size: 48))
                        .foregroundColor(.gray)
                }
            }
        }
        .task {
            image = await ImageCacheManager.shared.loadImage(from: imageURL)
            isLoading = false
        }
    }

    private var dismissDragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                dragOffset = value.translation
            }
            .onEnded { value in
                if abs(value.translation.height) > 120 {
                    onDismiss()
                } else {
                    withAnimation(.easeOut(duration: 0.2)) {
                        dragOffset = .zero
                    }
                }
            }
    }

    private var pinchGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                scale = max(lastScale * value, 0.5)
            }
            .onEnded { _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    if scale < 1 {
                        scale = 1; offset = .zero; lastOffset = .zero
                    }
                }
                lastScale = scale
            }
    }

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
                scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero
            } else {
                scale = 2.5; lastScale = 2.5
            }
        }
    }
}

// Keep backward-compatible single-image preview
struct ImagePreviewView: View {
    let imageURL: String

    var body: some View {
        ImageGalleryPreview(imageURLs: [imageURL], initialIndex: 0)
    }
}
