// BWChat/ViewModels/GroupsViewModel.swift
// Groups management view model

import Foundation
import Combine

@MainActor
class GroupsViewModel: ObservableObject {
    @Published var groups: [ChatGroup] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    init() {
        setupWebSocketListeners()
    }

    func loadGroups() async {
        isLoading = true
        do {
            groups = try await APIService.shared.getGroups()
        } catch {
            errorMessage = "加载群聊失败"
        }
        isLoading = false
    }

    func createGroup(name: String, memberIDs: [String]) async -> Bool {
        do {
            _ = try await APIService.shared.createGroup(name: name, memberIDs: memberIDs)
            await loadGroups()
            return true
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "创建失败"
        }
        return false
    }

    func markGroupAsRead(groupID: Int) {
        // Clear unread count locally
        if let index = groups.firstIndex(where: { $0.id == groupID }) {
            let g = groups[index]
            if g.unreadCount > 0 {
                // Reload groups to get fresh data with unread=0
                Task {
                    try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
                    await loadGroups()
                }
            }
        } else {
            // No local group found, just tell server
            Task {
                try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
            }
        }
    }

    private func setupWebSocketListeners() {
        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadGroups() }
            }
            .store(in: &cancellables)

        WebSocketService.shared.groupCreatedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadGroups() }
            }
            .store(in: &cancellables)
    }
}
