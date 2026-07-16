import SwiftUI

struct ScriptDetailView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: ScriptDetailViewModel
    @State private var selectedRole: ScriptRole?
    @State private var roleSelectionScript: InteractiveScript?
    @State private var showDeleteConfirmation = false

    init(scriptID: String, initialScript: InteractiveScript? = nil) {
        _viewModel = StateObject(
            wrappedValue: ScriptDetailViewModel(scriptID: scriptID, initialScript: initialScript)
        )
    }

    var body: some View {
        Group {
            if let script = viewModel.script {
                detail(script)
            } else if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScriptEmptyState(
                    icon: "exclamationmark.triangle",
                    title: ScriptText.value("无法加载剧本", "Unable to load script"),
                    subtitle: viewModel.errorMessage ?? ScriptText.value("请稍后重试", "Please try again")
                )
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(viewModel.script?.title ?? ScriptText.value("剧本详情", "Script Details"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task { await viewModel.load() }
        .onReceive(NotificationCenter.default.publisher(for: .scriptLibraryDidChange)) { notification in
            guard let changed = notification.object as? InteractiveScript,
                  changed.scriptID == viewModel.scriptID else { return }
            Task { await viewModel.load(force: true) }
        }
        .sheet(item: $selectedRole) { role in
            ScriptRoleInfoSheet(role: role)
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $roleSelectionScript) { script in
            ScriptRoleSelectionSheet(script: script) { roleID in
                await viewModel.createRoom(playerRoleID: roleID)
            }
            .presentationDetents([.medium, .large])
        }
        .confirmationDialog(
            ScriptText.value("删除这个剧本？", "Delete this script?"),
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button(ScriptText.value("删除", "Delete"), role: .destructive) {
                Task {
                    if await viewModel.deleteScript() { navigator.pop() }
                }
            }
            Button(ScriptText.value("取消", "Cancel"), role: .cancel) { }
        } message: {
            Text(ScriptText.value("已有房间不会被删除。", "Existing rooms will remain available."))
        }
        .toast(message: $viewModel.errorMessage, duration: 3)
    }

    private func detail(_ script: InteractiveScript) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                cover(script)
                summary(script)
                roles(script)
                if isOwner(script) { ownerActions(script) }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 110)
        }
        .safeAreaInset(edge: .bottom) {
            startBar(script)
        }
    }

    private func cover(_ script: InteractiveScript) -> some View {
        ZStack(alignment: .bottomLeading) {
            ScriptRemoteImage(urlString: script.coverURL, cornerRadius: 18)
                .frame(maxWidth: .infinity)
                .aspectRatio(1.55, contentMode: .fit)
                .clipped()

            LinearGradient(
                colors: [.clear, .black.opacity(0.72)],
                startPoint: .center,
                endPoint: .bottom
            )
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                Text(script.title)
                    .font(.system(size: 25, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(2)
                Text(script.creator.nickname)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white.opacity(0.82))
            }
            .padding(16)
        }
        .padding(.top, 12)
    }

    private func summary(_ script: InteractiveScript) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                statusBadge(ScriptText.status(script.status), color: AppColors.accent)
                statusBadge(ScriptText.visibility(script.visibility), color: script.visibility == .public ? AppColors.online : AppColors.secondaryText)
                if script.isAdminHidden {
                    statusBadge(ScriptText.value("后台隐藏", "Admin hidden"), color: AppColors.errorColor)
                }
            }

            Text(ScriptText.value("剧情简介", "Story"))
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
            Text(script.synopsis)
                .font(.system(size: 15))
                .foregroundColor(AppColors.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            if script.isAdminHidden, let reason = script.hiddenReason, !reason.isEmpty {
                Label(reason, systemImage: "exclamationmark.shield.fill")
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.errorColor)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppColors.errorColor.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(16)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func statusBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.1))
            .clipShape(Capsule())
    }

    private func roles(_ script: InteractiveScript) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(ScriptText.value("登场角色", "Characters"))
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(AppColors.primaryText)

            ForEach(script.roles) { role in
                Button { selectedRole = role } label: {
                    HStack(spacing: 12) {
                        ScriptRemoteImage(
                            urlString: role.avatarURL,
                            cornerRadius: 24,
                            fallbackSystemImage: "person.fill"
                        )
                            .frame(width: 48, height: 48)
                            .clipShape(Circle())
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(role.name)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(AppColors.primaryText)
                                Text(ScriptText.gender(role.gender))
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundColor(AppColors.accent)
                            }
                            Text(role.roleDescription)
                                .font(.system(size: 13))
                                .foregroundColor(AppColors.secondaryText)
                                .lineLimit(2)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if role.id != script.roles.last?.id { Divider() }
            }
        }
        .padding(16)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func ownerActions(_ script: InteractiveScript) -> some View {
        VStack(spacing: 0) {
            Button {
                navigator.push(ScriptEditorView(script: script))
            } label: {
                actionRow(title: ScriptText.value("编辑剧本", "Edit script"), icon: "square.and.pencil", color: AppColors.accent)
            }
            .buttonStyle(.plain)

            Divider().padding(.leading, 46)

            Button {
                Task {
                    await viewModel.setVisibility(script.visibility == .public ? .private : .public)
                }
            } label: {
                actionRow(
                    title: script.visibility == .public
                        ? ScriptText.value("设为私人", "Make private")
                        : ScriptText.value("立即公开", "Publish now"),
                    icon: script.visibility == .public ? "lock.fill" : "globe.asia.australia.fill",
                    color: script.visibility == .public ? AppColors.secondaryText : AppColors.online
                )
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isWorking)

            Divider().padding(.leading, 46)

            Button { showDeleteConfirmation = true } label: {
                actionRow(title: ScriptText.value("删除剧本", "Delete script"), icon: "trash", color: AppColors.errorColor)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func actionRow(title: String, icon: String, color: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .frame(width: 22)
                .foregroundColor(color)
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(color)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
        }
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    private func startBar(_ script: InteractiveScript) -> some View {
        VStack(spacing: 0) {
            Divider()
            Button {
                roleSelectionScript = script
            } label: {
                HStack {
                    if viewModel.isWorking { ProgressView().tint(.white) }
                    Text(ScriptText.value("选择角色，开始剧情", "Choose a role and begin"))
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(AppColors.accentGradient)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(script.status != .ready || script.isAdminHidden || script.roles.count < 2 || viewModel.isWorking)
            .opacity(script.status == .ready && !script.isAdminHidden && script.roles.count >= 2 ? 1 : 0.45)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(AppColors.cardBackground)
    }

    private func isOwner(_ script: InteractiveScript) -> Bool {
        script.isOwned(by: AuthManager.shared.currentUser?.userID)
    }
}

private struct ScriptRoleInfoSheet: View {
    @Environment(\.dismiss) private var dismiss
    let role: ScriptRole

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    ScriptRemoteImage(
                        urlString: role.avatarURL,
                        cornerRadius: 46,
                        fallbackSystemImage: "person.fill"
                    )
                        .frame(width: 92, height: 92)
                        .clipShape(Circle())
                    Text(role.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                    Text(ScriptText.gender(role.gender))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                    Text(role.roleDescription)
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(AppColors.cardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(20)
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle(ScriptText.value("角色详情", "Character"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(ScriptText.value("完成", "Done")) { dismiss() }
                }
            }
        }
    }
}

private struct ScriptRoleSelectionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator
    let script: InteractiveScript
    let onStart: (String) async -> ScriptRoom?

    @State private var selectedRoleID: String?
    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    Text(ScriptText.value("你将扮演一个角色，其余角色由 AI 群演。", "You play one character; AI plays the rest."))
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 4)

                    ForEach(script.roles) { role in
                        Button { selectedRoleID = role.id } label: {
                            HStack(spacing: 12) {
                                ScriptRemoteImage(
                                    urlString: role.avatarURL,
                                    cornerRadius: 24,
                                    fallbackSystemImage: "person.fill"
                                )
                                    .frame(width: 48, height: 48)
                                    .clipShape(Circle())
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(role.name)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundColor(AppColors.primaryText)
                                    Text(role.roleDescription)
                                        .font(.system(size: 12))
                                        .foregroundColor(AppColors.secondaryText)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Image(systemName: selectedRoleID == role.id ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 22))
                                    .foregroundColor(selectedRoleID == role.id ? AppColors.accent : AppColors.tertiaryText)
                            }
                            .padding(12)
                            .background(AppColors.cardBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle(ScriptText.value("选择角色", "Choose Character"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(ScriptText.value("取消", "Cancel")) { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        start()
                    } label: {
                        if isCreating { ProgressView() } else { Text(ScriptText.value("开始", "Start")) }
                    }
                    .disabled(selectedRoleID == nil || isCreating)
                }
            }
        }
        .toast(message: $errorMessage, duration: 3)
    }

    private func start() {
        guard let selectedRoleID, !isCreating else { return }
        isCreating = true
        Task {
            if let room = await onStart(selectedRoleID) {
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    navigator.push(ScriptRoomChatView(roomID: room.roomID, initialRoom: room))
                }
            } else {
                errorMessage = ScriptText.value("创建房间失败，请重试", "Unable to create room")
            }
            isCreating = false
        }
    }
}
