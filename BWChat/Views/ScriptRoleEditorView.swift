import PhotosUI
import SwiftUI
import UIKit

private enum ScriptRoleEditorField: Hashable {
    case name
    case publicDescription
    case hiddenSetting
}

struct ScriptRoleEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ScriptRoleDraft
    @State private var photoItem: PhotosPickerItem?
    @State private var validationMessage: String?
    @FocusState private var focusedField: ScriptRoleEditorField?

    let onSave: (ScriptRoleDraft) -> Void

    init(role: ScriptRoleDraft, onSave: @escaping (ScriptRoleDraft) -> Void) {
        _draft = State(initialValue: role)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(ScriptText.value("头像", "Avatar")) {
                    HStack {
                        Spacer()
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            roleAvatar
                        }
                        .buttonStyle(.plain)
                        Spacer()
                    }
                    .listRowBackground(AppColors.cardBackground)
                }

                Section(ScriptText.value("公开资料", "Public Profile")) {
                    VStack(alignment: .leading, spacing: 6) {
                        TextField(ScriptText.value("角色名称", "Character name"), text: $draft.name)
                            .focused($focusedField, equals: .name)
                            .onChange(of: draft.name) { draft.name = String($0.prefix(8)) }
                        Text("\(draft.name.count)/8")
                            .font(.system(size: 11))
                            .foregroundColor(AppColors.tertiaryText)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }

                    Picker(ScriptText.value("性别", "Gender"), selection: $draft.gender) {
                        Text(ScriptText.value("请选择", "Select")).tag("unspecified")
                        Text(ScriptText.gender("female")).tag("female")
                        Text(ScriptText.gender("male")).tag("male")
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text(ScriptText.value("公开描述", "Public description"))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                        TextEditor(text: $draft.roleDescription)
                            .focused($focusedField, equals: .publicDescription)
                            .frame(minHeight: 110)
                            .onChange(of: draft.roleDescription) {
                                draft.roleDescription = String($0.prefix(100))
                            }
                        Text("\(draft.roleDescription.count)/100")
                            .font(.system(size: 11))
                            .foregroundColor(AppColors.tertiaryText)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }

                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        TextEditor(text: $draft.hiddenSetting)
                            .focused($focusedField, equals: .hiddenSetting)
                            .frame(minHeight: 110)
                            .onChange(of: draft.hiddenSetting) {
                                draft.hiddenSetting = String($0.prefix(500))
                            }
                        Text("\(draft.hiddenSetting.count)/500")
                            .font(.system(size: 11))
                            .foregroundColor(AppColors.tertiaryText)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                } header: {
                    Text(ScriptText.value("AI 隐藏设定", "Hidden AI Setting"))
                } footer: {
                    Text(ScriptText.value("仅你和服务端生成过程可读取，不会展示给其他用户。", "Only you and server-side generation can read this."))
                }
            }
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .background(AppColors.secondaryBackground)
            .navigationTitle(ScriptText.value("编辑角色", "Edit Character"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(ScriptText.value("取消", "Cancel")) {
                        dismissEditorInputState()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(ScriptText.value("保存", "Save")) { save() }
                        .fontWeight(.semibold)
                }
            }
            .onChange(of: photoItem) { item in
                dismissEditorInputState()
                Task { await loadPhoto(item) }
            }
        }
        .toast(message: $validationMessage, duration: 3)
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

    @ViewBuilder
    private var roleAvatar: some View {
        if let data = draft.avatarData, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 92, height: 92)
                .clipShape(Circle())
                .overlay(Circle().stroke(AppColors.accent, lineWidth: 2))
        } else if !draft.avatarURL.isEmpty {
            ScriptRemoteImage(urlString: draft.avatarURL, cornerRadius: 46)
                .frame(width: 92, height: 92)
                .clipShape(Circle())
                .overlay(Circle().stroke(AppColors.accent, lineWidth: 2))
        } else {
            ZStack {
                Circle().fill(AppColors.accentLight)
                Image(systemName: "camera.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(AppColors.accent)
            }
            .frame(width: 92, height: 92)
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self) else { return }
        let compressed = APIService.compressImageForUpload(
            data,
            maxDimension: 800,
            quality: 0.8,
            maxBytes: 700_000
        )
        guard UIImage(data: compressed) != nil else { return }
        draft.avatarData = compressed
    }

    private func save() {
        dismissEditorInputState()
        guard !draft.trimmedName.isEmpty else {
            validationMessage = ScriptText.value("请填写角色名称", "Enter a character name")
            return
        }
        guard draft.trimmedName.count <= 8 else {
            validationMessage = ScriptText.value("角色名称最多 8 个字符", "Character names can contain up to 8 characters")
            return
        }
        guard ["female", "male"].contains(draft.gender) else {
            validationMessage = ScriptText.value("请选择角色性别", "Select the character's gender")
            return
        }
        guard !draft.trimmedDescription.isEmpty else {
            validationMessage = ScriptText.value("请填写公开描述", "Enter a public description")
            return
        }
        guard draft.trimmedDescription.count <= 100 else {
            validationMessage = ScriptText.value("公开描述最多 100 个字符", "Public descriptions can contain up to 100 characters")
            return
        }
        guard !draft.avatarURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.avatarData != nil else {
            validationMessage = ScriptText.value("请选择角色头像", "Choose a character avatar")
            return
        }
        onSave(draft)
        dismiss()
    }

    private func dismissEditorInputState() {
        focusedField = nil
        hideKeyboard()
    }
}
