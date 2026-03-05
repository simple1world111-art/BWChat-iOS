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
