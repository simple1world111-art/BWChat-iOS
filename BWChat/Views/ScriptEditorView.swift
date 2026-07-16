import PhotosUI
import SwiftUI
import UIKit

private enum ScriptEditorField: Hashable {
    case title
    case synopsis
    case worldSetting
}

struct ScriptEditorView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: ScriptEditorViewModel
    @State private var coverItem: PhotosPickerItem?
    @State private var editingRole: ScriptRoleDraft?
    @FocusState private var focusedField: ScriptEditorField?

    init(script: InteractiveScript?) {
        _viewModel = StateObject(wrappedValue: ScriptEditorViewModel(script: script))
    }

    var body: some View {
        Form {
            visibilitySection
            coverSection
            titleSection
            synopsisSection
            categorySection
            worldSection
            rolesSection
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(AppColors.secondaryBackground)
        .navigationTitle(
            viewModel.isEditing
                ? ScriptText.value("编辑剧本", "Edit Script")
                : ScriptText.value("创建剧本", "Create Script")
        )
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .hidesTabBarOnPush()
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    dismissEditorInputState()
                    navigator.pop()
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    dismissEditorInputState()
                    Task {
                        if await viewModel.save() != nil { navigator.pop() }
                    }
                } label: {
                    if viewModel.isSaving {
                        ProgressView()
                    } else {
                        Text(ScriptText.value("保存", "Save")).fontWeight(.semibold)
                    }
                }
                .disabled(viewModel.isSaving)
            }
        }
        .task { await viewModel.loadCategories() }
        .onChange(of: coverItem) { item in
            dismissEditorInputState()
            Task { await loadCover(item) }
        }
        .sheet(item: $editingRole) { role in
            ScriptRoleEditorView(role: role, onSave: upsertRole)
                .presentationDetents([.large])
        }
        .toast(message: $viewModel.errorMessage, duration: 3.5)
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

    private var visibilitySection: some View {
        Section {
            Toggle(isOn: visibilityBinding) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(ScriptText.value("公开剧本", "Public script"))
                    Text(ScriptText.value("完整后公开会立即展示", "Complete scripts appear immediately"))
                        .font(.system(size: 12))
                        .foregroundColor(AppColors.secondaryText)
                }
            }
            .tint(AppColors.accent)
        } header: {
            sectionHeader(ScriptText.value("发布设置", "Publishing"))
        }
    }

    private var visibilityBinding: Binding<Bool> {
        Binding(
            get: { viewModel.draft.visibility == .public },
            set: {
                dismissEditorInputState()
                viewModel.draft.visibility = $0 ? .public : .private
            }
        )
    }

    private var coverSection: some View {
        Section {
            PhotosPicker(selection: $coverItem, matching: .images) {
                coverPreview
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } header: {
            sectionHeader(ScriptText.value("剧本封面", "Script Cover"))
        }
    }

    private var titleSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                TextField(ScriptText.value("请输入剧本标题", "Enter script title"), text: $viewModel.draft.title)
                    .focused($focusedField, equals: .title)
                    .onChange(of: viewModel.draft.title) {
                        viewModel.draft.title = String($0.prefix(15))
                    }
                Text("\(viewModel.draft.title.count)/15")
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        } header: {
            sectionHeader(ScriptText.value("剧本标题", "Script Title"))
        } footer: {
            Text(ScriptText.value("公开剧本需要填写 5～15 个字符。", "Public scripts require 5–15 characters."))
        }
    }

    private var synopsisSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                TextEditor(text: $viewModel.draft.synopsis)
                    .focused($focusedField, equals: .synopsis)
                    .frame(minHeight: 130)
                    .onChange(of: viewModel.draft.synopsis) {
                        viewModel.draft.synopsis = String($0.prefix(500))
                    }
                Text("\(viewModel.draft.synopsis.count)/500")
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        } header: {
            sectionHeader(ScriptText.value("剧情简介", "Synopsis"))
        } footer: {
            Text(ScriptText.value("公开剧本需要填写 20～500 个字符。", "Public scripts require 20–500 characters."))
        }
    }

    @ViewBuilder
    private var coverPreview: some View {
        if let data = viewModel.draft.coverData, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(height: 180)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 14))
        } else if !viewModel.draft.coverURL.isEmpty {
            ScriptRemoteImage(urlString: viewModel.draft.coverURL, cornerRadius: 14)
                .frame(height: 180)
        } else {
            VStack(spacing: 9) {
                Image(systemName: "photo.badge.plus")
                    .font(.system(size: 30, weight: .semibold))
                Text(ScriptText.value("选择剧本封面", "Choose cover"))
                    .font(.system(size: 14, weight: .medium))
            }
            .foregroundColor(AppColors.accent)
            .frame(maxWidth: .infinity, minHeight: 150)
            .background(AppColors.accentLight)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private var categorySection: some View {
        Section {
            if viewModel.categories.isEmpty {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                ForEach(viewModel.categories) { category in
                    Button {
                        toggleCategory(category.id)
                    } label: {
                        HStack {
                            Text(category.name)
                                .foregroundColor(AppColors.primaryText)
                            Spacer()
                            Image(systemName: viewModel.draft.categoryIDs.contains(category.id) ? "checkmark.circle.fill" : "circle")
                                .foregroundColor(viewModel.draft.categoryIDs.contains(category.id) ? AppColors.accent : AppColors.tertiaryText)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        } header: {
            sectionHeader(ScriptText.value("剧本分类", "Script Categories"))
        } footer: {
            Text(ScriptText.value("公开剧本至少选择一个分类。", "Public scripts require at least one category."))
        }
    }

    private var worldSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                TextEditor(text: $viewModel.draft.worldSetting)
                    .focused($focusedField, equals: .worldSetting)
                    .frame(minHeight: 120)
                    .onChange(of: viewModel.draft.worldSetting) {
                        viewModel.draft.worldSetting = String($0.prefix(500))
                    }
                Text("\(viewModel.draft.worldSetting.count)/500")
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        } header: {
            sectionHeader(ScriptText.value("世界隐藏设定", "Hidden World Setting"))
        } footer: {
            Text(ScriptText.value("不会展示在公开详情，仅用于服务端生成剧情。", "Not shown publicly; used only for server-side generation."))
        }
    }

    private var rolesSection: some View {
        Section {
            ForEach(viewModel.draft.roles) { role in
                HStack(spacing: 12) {
                    Button {
                        dismissEditorInputState()
                        editingRole = role
                    } label: {
                        HStack(spacing: 12) {
                            roleAvatar(role)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(role.trimmedName.isEmpty ? ScriptText.value("未命名角色", "Unnamed character") : role.trimmedName)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(AppColors.primaryText)
                                Text(role.trimmedDescription.isEmpty ? ScriptText.value("点击补充角色资料", "Tap to add details") : role.trimmedDescription)
                                    .font(.system(size: 12))
                                    .foregroundColor(AppColors.secondaryText)
                                    .lineLimit(1)
                            }
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    Button(role: .destructive) {
                        dismissEditorInputState()
                        viewModel.draft.roles.removeAll { $0.id == role.id }
                    } label: {
                        Image(systemName: "trash")
                            .foregroundColor(AppColors.errorColor)
                    }
                    .buttonStyle(.plain)
                }
            }

            Button {
                dismissEditorInputState()
                guard viewModel.draft.roles.count < 12 else {
                    viewModel.errorMessage = ScriptText.value("最多添加 12 个角色", "You can add up to 12 characters")
                    return
                }
                editingRole = ScriptRoleDraft()
            } label: {
                Label(ScriptText.value("添加角色", "Add Character"), systemImage: "plus.circle.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AppColors.accent)
            }
        } header: {
            sectionHeader(
                ScriptText.value(
                    "角色列表（\(viewModel.draft.roles.count)/12）",
                    "Characters (\(viewModel.draft.roles.count)/12)"
                )
            )
        } footer: {
            Text(ScriptText.value("公开或开局至少需要两个完整角色。", "Publishing or starting requires at least two complete characters."))
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(.black)
            .textCase(nil)
    }

    @ViewBuilder
    private func roleAvatar(_ role: ScriptRoleDraft) -> some View {
        if let data = role.avatarData, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 42, height: 42)
                .clipShape(Circle())
        } else if !role.avatarURL.isEmpty {
            ScriptRemoteImage(urlString: role.avatarURL, cornerRadius: 21)
                .frame(width: 42, height: 42)
                .clipShape(Circle())
        } else {
            Circle()
                .fill(AppColors.accentLight)
                .frame(width: 42, height: 42)
                .overlay(Image(systemName: "person.fill").foregroundColor(AppColors.accent))
        }
    }

    private func toggleCategory(_ id: String) {
        dismissEditorInputState()
        if viewModel.draft.categoryIDs.contains(id) {
            viewModel.draft.categoryIDs.remove(id)
        } else {
            viewModel.draft.categoryIDs.insert(id)
        }
    }

    private func upsertRole(_ role: ScriptRoleDraft) {
        if let index = viewModel.draft.roles.firstIndex(where: { $0.id == role.id }) {
            viewModel.draft.roles[index] = role
        } else {
            viewModel.draft.roles.append(role)
        }
    }

    private func dismissEditorInputState() {
        focusedField = nil
        hideKeyboard()
    }

    private func loadCover(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self) else { return }
        let compressed = APIService.compressImageForUpload(
            data,
            maxDimension: 1600,
            quality: 0.82,
            maxBytes: 1_500_000
        )
        guard UIImage(data: compressed) != nil else { return }
        viewModel.draft.coverData = compressed
    }
}
