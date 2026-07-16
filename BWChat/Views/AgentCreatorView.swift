// BWChat/Views/AgentCreatorView.swift

import PhotosUI
import SwiftUI
import UIKit

struct AgentCreatorView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: AgentCreatorViewModel
    @State private var referenceItem: PhotosPickerItem?
    @State private var isLoadingReference = false
    let onSaved: (AgentSummary) -> Void

    init(mode: AgentCreatorViewModel.Mode, onSaved: @escaping (AgentSummary) -> Void = { _ in }) {
        _viewModel = StateObject(wrappedValue: AgentCreatorViewModel(mode: mode))
        self.onSaved = onSaved
    }

    var body: some View {
        Form {
            referenceSection
            nameSection
            taglineSection
            descriptionSection
            tagsSection
            languageSection
            visibilitySection
            identitySection
            personalitySection
            toneSection
            replyLengthSection
            greetingSection
            relationshipTypeSection
            addressStyleSection
            adultInteractionSection
            intimacyStyleSection
            initiativeSection
            imageCapabilitySection
            videoCapabilitySection

            if let error = viewModel.errorMessage {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.errorColor)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollContentBackground(.hidden)
        .background(AppColors.secondaryBackground)
        .navigationTitle(viewModel.isEditing ? "调整智能体" : "创建智能体")
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    hideKeyboard()
                    Task {
                        if let agent = await viewModel.saveAndPublish() {
                            onSaved(agent)
                            navigator.pop()
                        }
                    }
                } label: {
                    if viewModel.isSaving {
                        ProgressView().scaleEffect(0.8)
                    } else {
                        Text(viewModel.isEditing ? "保存" : "创建")
                            .fontWeight(.semibold)
                    }
                }
                .disabled(!viewModel.canSave)
            }
        }
        .onChange(of: referenceItem) { item in
            guard let item else { return }
            hideKeyboard()
            Task { await loadReference(item) }
        }
        .background(
            KeyboardDismissTapInstaller(
                isEnabled: true,
                consumesOutsideTaps: false,
                dismissesOnControls: true,
                onBackgroundTap: hideKeyboard
            )
        )
        .onDisappear {
            hideKeyboard()
        }
    }

    private var referenceSection: some View {
        let isEditing = viewModel.isEditing
        return Section {
            PhotosPicker(selection: $referenceItem, matching: .images) {
                HStack(spacing: 14) {
                    referencePreview
                    VStack(alignment: .leading, spacing: 5) {
                        Text(isEditing ? "更换主参考图" : "上传主参考图")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(AppColors.primaryText)
                        Text("短边至少 512 像素，宽高比 1:2 到 2:1")
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    Spacer()
                    if isLoadingReference { ProgressView() }
                }
            }
            .disabled(isLoadingReference || viewModel.isSaving)
        } header: {
            sectionHeader("视觉形象")
        }
    }

    @ViewBuilder
    private var referencePreview: some View {
        if let data = viewModel.selectedReferenceData, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(AppColors.accentLight)
                Image(systemName: "photo.badge.plus")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(AppColors.accent)
            }
            .frame(width: 64, height: 64)
        }
    }

    private var nameSection: some View {
        Section {
            TextField("请输入智能体名称", text: $viewModel.name)
        } header: {
            sectionHeader("智能体名称")
        }
    }

    private var taglineSection: some View {
        Section {
            TextField("用一句话介绍这个智能体", text: $viewModel.tagline)
        } header: {
            sectionHeader("一句话介绍")
        }
    }

    private var descriptionSection: some View {
        Section {
            TextField("补充角色背景、特点和用途", text: $viewModel.descriptionText, axis: .vertical)
                .lineLimit(3...7)
        } header: {
            sectionHeader("详细描述")
        }
    }

    private var tagsSection: some View {
        Section {
            TextField("多个标签请用逗号分隔", text: $viewModel.tagsText)
        } header: {
            sectionHeader("标签")
        }
    }

    private var languageSection: some View {
        Section {
            Picker("对话语言", selection: $viewModel.language) {
                Text("简体中文").tag("zh-CN")
                Text("English").tag("en")
                Text("日本語").tag("ja")
            }
        } header: {
            sectionHeader("语言")
        }
    }

    private var visibilitySection: some View {
        Section {
            Picker("谁可以看到", selection: $viewModel.visibility) {
                Text("私有").tag("private")
                Text("不公开列出").tag("unlisted")
                Text("公开").tag("public")
            }
        } header: {
            sectionHeader("可见性")
        }
    }

    private var identitySection: some View {
        Section {
            TextField("身份设定", text: $viewModel.identity, axis: .vertical)
                .lineLimit(3...8)
        } header: {
            sectionHeader("身份设定")
        }
    }

    private var personalitySection: some View {
        Section {
            TextField("性格，用逗号分隔", text: $viewModel.personalityText)
        } header: {
            sectionHeader("性格")
        }
    }

    private var toneSection: some View {
        Section {
            Picker("语气", selection: $viewModel.toneStyle) {
                Text("温暖").tag("warm")
                Text("自然").tag("natural")
                Text("俏皮").tag("playful")
                Text("直接").tag("direct")
            }
        } header: {
            sectionHeader("对话语气")
        }
    }

    private var replyLengthSection: some View {
        Section {
            Picker("回复长度", selection: $viewModel.replyLength) {
                Text("简短").tag("short")
                Text("适中").tag("medium")
                Text("详细").tag("long")
            }
        } header: {
            sectionHeader("回复长度")
        }
    }

    private var greetingSection: some View {
        Section {
            TextField("开场白", text: $viewModel.greeting, axis: .vertical)
                .lineLimit(2...5)
        } header: {
            sectionHeader("开场白")
        }
    }

    private var relationshipTypeSection: some View {
        Section {
            Picker("关系类型", selection: $viewModel.relationshipType) {
                Text("陪伴者").tag("companion")
                Text("女朋友").tag("girlfriend")
                Text("妻子").tag("wife")
                Text("约会对象").tag("dating_partner")
                Text("浪漫伴侣").tag("romantic_partner")
                Text("男朋友").tag("boyfriend")
                Text("丈夫").tag("husband")
            }
        } header: {
            sectionHeader("关系类型")
        }
    }

    private var addressStyleSection: some View {
        Section {
            TextField("例如：你、主人、亲爱的", text: $viewModel.addressStyle)
        } header: {
            sectionHeader("称呼方式")
        }
    }

    private var adultInteractionSection: some View {
        Section {
            Toggle("允许成人互动", isOn: $viewModel.adultEnabled)
        } header: {
            sectionHeader("成人互动")
        }
    }

    private var intimacyStyleSection: some View {
        Section {
            Picker("亲密风格", selection: $viewModel.intimacyStyle) {
                Text("浪漫").tag("romantic")
                Text("俏皮").tag("playful")
                Text("感性").tag("sensual")
                Text("直接").tag("direct")
            }
        } header: {
            sectionHeader("亲密风格")
        }
    }

    private var initiativeSection: some View {
        Section {
            Picker("主动程度", selection: $viewModel.initiative) {
                Text("回应式").tag("responsive")
                Text("平衡").tag("balanced")
                Text("主动").tag("proactive")
            }
        } header: {
            sectionHeader("主动程度")
        }
    }

    private var imageCapabilitySection: some View {
        Section {
            Toggle("付费图片", isOn: $viewModel.paidImages)
        } header: {
            sectionHeader("图片能力")
        }
    }

    private var videoCapabilitySection: some View {
        Section {
            Toggle("付费视频", isOn: .constant(false))
                .disabled(true)
            Text("视频 Provider 当前未启用，客户端不会开放视频生成。")
                .font(.system(size: 12))
                .foregroundColor(AppColors.secondaryText)
        } header: {
            sectionHeader("视频能力")
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(.black)
            .textCase(nil)
    }

    private func loadReference(_ item: PhotosPickerItem) async {
        isLoadingReference = true
        defer {
            isLoadingReference = false
            referenceItem = nil
        }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else {
            viewModel.errorMessage = "无法读取所选图片"
            return
        }
        let shortSide = min(image.size.width, image.size.height)
        let ratio = image.size.width / max(image.size.height, 1)
        guard shortSide >= 512, (0.5...2).contains(ratio) else {
            viewModel.errorMessage = "参考图短边至少 512 像素，宽高比需在 1:2 到 2:1 之间"
            return
        }
        viewModel.selectedReferenceData = image.jpegData(compressionQuality: 0.92)
        viewModel.errorMessage = nil
    }
}
