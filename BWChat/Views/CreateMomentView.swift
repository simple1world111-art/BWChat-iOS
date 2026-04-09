import SwiftUI
import PhotosUI

struct CreateMomentView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var content = ""
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var selectedImages: [UIImage] = []
    @State private var isPublishing = false

    var onPublish: (String, [UIImage]) async -> Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        TextEditor(text: $content)
                            .font(.system(size: 16))
                            .frame(minHeight: 120)
                            .padding(.horizontal, 4)
                            .scrollContentBackground(.hidden)

                        if !selectedImages.isEmpty {
                            imagePreviewGrid
                        }

                        if selectedImages.count < 9 {
                            PhotosPicker(selection: $selectedItems, maxSelectionCount: max(1, 9 - selectedImages.count), matching: .images) {
                                HStack(spacing: 8) {
                                    Image(systemName: "photo.badge.plus")
                                        .font(.system(size: 20))
                                    Text(selectedImages.isEmpty ? "添加图片" : "继续添加")
                                        .font(.system(size: 15))
                                }
                                .foregroundColor(AppColors.accent)
                                .padding(.vertical, 8)
                            }
                            .onChange(of: selectedItems) { items in
                                Task {
                                    for item in items {
                                        if let data = try? await item.loadTransferable(type: Data.self),
                                           let uiImage = UIImage(data: data) {
                                            if selectedImages.count < 9 {
                                                selectedImages.append(uiImage)
                                            }
                                        }
                                    }
                                    selectedItems = []
                                }
                            }
                        }
                    }
                    .padding(16)
                }

                Divider()
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle("发朋友圈")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                        .foregroundColor(AppColors.secondaryText)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        isPublishing = true
                        Task {
                            let success = await onPublish(content, selectedImages)
                            if !success { isPublishing = false }
                        }
                    } label: {
                        Text("发表")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .background(canPublish ? AppColors.accentGradient : LinearGradient(colors: [AppColors.separator], startPoint: .top, endPoint: .bottom))
                            .cornerRadius(6)
                    }
                    .disabled(!canPublish || isPublishing)
                }
            }
        }
    }

    private var canPublish: Bool {
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !selectedImages.isEmpty
    }

    private var imagePreviewGrid: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)
        return LazyVGrid(columns: columns, spacing: 8) {
            ForEach(Array(selectedImages.enumerated()), id: \.offset) { index, image in
                ZStack(alignment: .topTrailing) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 100, height: 100)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    Button {
                        selectedImages.remove(at: index)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 18))
                            .foregroundColor(.white)
                            .shadow(radius: 2)
                    }
                    .offset(x: 4, y: -4)
                }
            }
        }
    }
}
