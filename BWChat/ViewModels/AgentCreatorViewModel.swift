// BWChat/ViewModels/AgentCreatorViewModel.swift

import Foundation

@MainActor
final class AgentCreatorViewModel: ObservableObject {
    enum Mode {
        case create
        case edit(AgentSummary)
    }

    @Published var name = ""
    @Published var tagline = ""
    @Published var descriptionText = ""
    @Published var tagsText = "companion"
    @Published var language = "zh-CN"
    @Published var visibility = "private"
    @Published var identity = ""
    @Published var personalityText = "温暖, 细心"
    @Published var toneStyle = "warm"
    @Published var replyLength = "medium"
    @Published var relationshipType = "companion"
    @Published var addressStyle = "natural"
    @Published var adultEnabled = false
    @Published var intimacyStyle = "romantic"
    @Published var initiative = "responsive"
    @Published var greeting = "你好"
    @Published var paidImages = true
    @Published var selectedReferenceData: Data?
    @Published private(set) var isSaving = false
    @Published private(set) var savedAgent: AgentSummary?
    @Published var errorMessage: String?

    let mode: Mode
    private var currentAgent: AgentSummary?
    private var referenceAssetID: String?
    private var avatarAssetID: String?
    private var uploadIdempotencyKey = UUID()
    private var createIdempotencyKey = UUID()
    private var publishIdempotencyKey = UUID()
    private var conversationIdempotencyKey = UUID()

    init(mode: Mode) {
        self.mode = mode
        if case .edit(let agent) = mode {
            currentAgent = agent
            populate(from: agent)
        }
    }

    var isEditing: Bool { currentAgent != nil }

    var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !greeting.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (isEditing || selectedReferenceData != nil)
            && !isSaving
    }

    func saveAndPublish() async -> AgentSummary? {
        guard canSave else { return nil }
        let isCreatingNewAgent = currentAgent == nil
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            if let selectedReferenceData {
                let upload = try await APIService.shared.uploadAgentReference(
                    selectedReferenceData,
                    filename: "agent-reference.jpg",
                    idempotencyKey: uploadIdempotencyKey
                )
                referenceAssetID = upload.primaryReferenceAssetID
                avatarAssetID = upload.avatarAssetID
            }

            let draft: AgentSummary
            if let currentAgent {
                draft = try await APIService.shared.updateAgentDraft(
                    id: currentAgent.id,
                    expectedRevision: currentAgent.revision ?? 0,
                    patch: patchPayload()
                )
            } else {
                guard let referenceAssetID, let avatarAssetID else {
                    throw APIError.serverError(code: 400, message: "请先选择符合要求的主参考图")
                }
                draft = try await APIService.shared.createAgent(
                    payload: createPayload(referenceAssetID: referenceAssetID, avatarAssetID: avatarAssetID),
                    idempotencyKey: createIdempotencyKey
                )
            }

            _ = try await APIService.shared.publishAgent(id: draft.id, idempotencyKey: publishIdempotencyKey)
            let installed = try await APIService.shared.installAgent(id: draft.id)
            savedAgent = installed
            currentAgent = installed
            if isCreatingNewAgent {
                _ = try? await APIService.shared.createAgentConversation(
                    agentID: installed.id,
                    greetingID: installed.greetings?.first?.id ?? "default",
                    idempotencyKey: conversationIdempotencyKey
                )
            }
            NotificationCenter.default.post(name: .conversationListNeedsReload, object: nil)
            return installed
        } catch {
            if case APIError.serverError(let code, _) = error, code == 6002,
               let currentAgent {
                if let latest = try? await APIService.shared.getAgent(id: currentAgent.id) {
                    self.currentAgent = latest
                    populate(from: latest)
                }
                errorMessage = "草稿已在其他位置更新，已重新加载最新版本，请确认后再保存。"
            } else {
                errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
            return nil
        }
    }

    private func populate(from agent: AgentSummary) {
        name = agent.profile?.name ?? ""
        tagline = agent.profile?.tagline ?? ""
        descriptionText = agent.profile?.description ?? ""
        tagsText = (agent.profile?.tags ?? []).joined(separator: ", ")
        language = agent.profile?.language ?? "zh-CN"
        visibility = agent.visibility ?? "private"
        identity = agent.definition?.identity ?? ""
        personalityText = (agent.definition?.personality ?? []).joined(separator: ", ")
        toneStyle = agent.definition?.tone?.style ?? "warm"
        replyLength = agent.definition?.tone?.replyLength ?? "medium"
        relationshipType = agent.definition?.relationship?.type ?? "companion"
        addressStyle = agent.definition?.relationship?.addressStyle ?? "natural"
        adultEnabled = agent.definition?.intimacy?.adultEnabled ?? false
        intimacyStyle = agent.definition?.intimacy?.style ?? "romantic"
        initiative = agent.definition?.intimacy?.initiative ?? "responsive"
        greeting = agent.definition?.greetings?.first?.text
            ?? agent.greetings?.first?.text
            ?? "你好"
        paidImages = agent.definition?.capabilities?.paidImages
            ?? agent.capabilities?.paidImages
            ?? true
        referenceAssetID = agent.primaryReferenceAssetID
        avatarAssetID = agent.resolvedAvatarAssetID
    }

    private func createPayload(referenceAssetID: String, avatarAssetID: String) -> [String: Any] {
        var payload = patchPayload()
        payload["primary_reference_asset_id"] = referenceAssetID
        payload["avatar_asset_id"] = avatarAssetID
        return payload
    }

    private func patchPayload() -> [String: Any] {
        var payload: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "tagline": tagline.trimmingCharacters(in: .whitespacesAndNewlines),
            "description": descriptionText.trimmingCharacters(in: .whitespacesAndNewlines),
            "tags": commaSeparated(tagsText),
            "language": language,
            "visibility": visibility,
            "definition": definitionPayload()
        ]
        if let referenceAssetID { payload["primary_reference_asset_id"] = referenceAssetID }
        if let avatarAssetID { payload["avatar_asset_id"] = avatarAssetID }
        return payload
    }

    private func definitionPayload() -> [String: Any] {
        [
            "identity": identity.trimmingCharacters(in: .whitespacesAndNewlines),
            "personality": commaSeparated(personalityText),
            "tone": ["style": toneStyle, "reply_length": replyLength],
            "relationship": ["type": relationshipType, "address_style": addressStyle],
            "intimacy": [
                "adult_enabled": adultEnabled,
                "style": intimacyStyle,
                "initiative": initiative
            ],
            "greetings": [["id": "default", "text": greeting.trimmingCharacters(in: .whitespacesAndNewlines)]],
            "example_dialogues": [],
            "visual_identity": ["description": descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)],
            "capabilities": [
                "paid_images": paidImages,
                "paid_videos": false,
                "stickers": false,
                "platform_rewards": false,
                "proactive_messages": false
            ]
        ]
    }

    private func commaSeparated(_ value: String) -> [String] {
        value.split(whereSeparator: { $0 == "," || $0 == "，" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}
