// BWChat/Views/BotConfigView.swift
// Create-or-edit form for a bot (智能体). Two modes:
//   .create  — shown as a sheet, Save dismisses via @Environment(\.dismiss)
//   .edit    — pushed onto UIKitNav, saved inline and the page stays

import SwiftUI

struct BotConfigView: View {
    enum Mode {
        case create
        case edit(BotConfig)
    }

    let mode: Mode

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var store = BotStore.shared

    @State private var draft: BotConfig
    @State private var showAdvanced = false
    @State private var showDeleteAlert = false

    init(mode: Mode) {
        self.mode = mode
        switch mode {
        case .create:
            _draft = State(initialValue: BotConfig(
                name: "",
                emoji: "🤖",
                persona: ""
            ))
        case .edit(let bot):
            _draft = State(initialValue: bot)
        }
    }

    private var isCreate: Bool {
        if case .create = mode { return true }
        return false
    }

    private var canSave: Bool {
        !draft.name.trimmingCharacters(in: .whitespaces).isEmpty
        && !draft.persona.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        Group {
            if isCreate {
                NavigationStack { form }
            } else {
                form
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        Form {
            Section("基础信息") {
                HStack {
                    Text("头像")
                    Spacer()
                    TextField("🤖", text: $draft.emoji)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 80)
                }
                HStack {
                    Text("名字")
                    Spacer()
                    TextField("例如：林悦", text: $draft.name)
                        .multilineTextAlignment(.trailing)
                }
            }

            Section {
                TextField("你是林悦，25岁的上海女孩，说话温柔带点撒娇……", text: $draft.persona, axis: .vertical)
                    .lineLimit(3...8)
            } header: {
                Text("人设 (Persona)")
            } footer: {
                Text("描述这个智能体的角色、性格、说话风格。后端会基于此构造 system prompt。")
            }

            Section("生成参数") {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("创造性 (temperature)")
                        Spacer()
                        Text(String(format: "%.2f", draft.temperature))
                            .foregroundColor(AppColors.secondaryText)
                            .font(.system(size: 14, design: .monospaced))
                    }
                    Slider(value: $draft.temperature, in: 0.1...1.5, step: 0.05)
                }

                Picker("回复长度", selection: $draft.maxTokens) {
                    Text("短 (200)").tag(200)
                    Text("中 (400)").tag(400)
                    Text("长 (800)").tag(800)
                }
            }

            Section {
                DisclosureGroup("高级参数", isExpanded: $showAdvanced) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("聚焦度 (top_p)")
                            Spacer()
                            Text(String(format: "%.2f", draft.topP))
                                .foregroundColor(AppColors.secondaryText)
                                .font(.system(size: 14, design: .monospaced))
                        }
                        Slider(value: $draft.topP, in: 0.1...1.0, step: 0.05)
                    }

                    Toggle("思考模式 (enable_thinking)", isOn: $draft.enableThinking)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("完整 System Prompt（可选）")
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.secondaryText)
                        TextField("如果填写，将覆盖 Persona", text: $draft.systemPrompt, axis: .vertical)
                            .lineLimit(2...6)
                            .font(.system(size: 14))
                    }
                }
            }

            if !isCreate, draft.id != BotConfig.defaultGirlfriend.id {
                Section {
                    Button(role: .destructive) {
                        showDeleteAlert = true
                    } label: {
                        HStack {
                            Spacer()
                            Text("删除该智能体")
                            Spacer()
                        }
                    }
                }
            }
        }
        .navigationTitle(isCreate ? "创建智能体" : "智能体设置")
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .toolbar {
            if isCreate {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(isCreate ? "创建" : "保存") { save() }
                    .disabled(!canSave)
            }
        }
        .alert("删除该智能体？", isPresented: $showDeleteAlert) {
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) {
                store.delete(draft.id)
                navigator.popToRoot()
            }
        } message: {
            Text("聊天记录也会一并清除。")
        }
    }

    private func save() {
        var bot = draft
        bot.name = bot.name.trimmingCharacters(in: .whitespaces)
        bot.emoji = bot.emoji.trimmingCharacters(in: .whitespaces)
        if bot.emoji.isEmpty { bot.emoji = "🤖" }
        store.addOrUpdate(bot)
        if isCreate {
            dismiss()
        }
    }
}
