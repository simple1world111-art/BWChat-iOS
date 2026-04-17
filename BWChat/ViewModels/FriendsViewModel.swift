// BWChat/ViewModels/FriendsViewModel.swift
// Friends management view model

import Foundation
import Combine

@MainActor
class FriendsViewModel: ObservableObject {
    @Published var searchText: String = ""
    @Published var searchResults: [SearchUser] = []
    @Published var friendRequests: [FriendRequest] = []
    @Published var friends: [FriendInfo] = []
    @Published var isSearching = false
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var successMessage: String?

    private var searchTask: Task<Void, Never>?

    func searchUsers() async {
        let keyword = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !keyword.isEmpty else {
            searchResults = []
            return
        }
        isSearching = true
        do {
            searchResults = try await APIService.shared.searchUsers(keyword: keyword)
        } catch {
            searchResults = []
        }
        isSearching = false
    }

    func debouncedSearch() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            await searchUsers()
        }
    }

    func loadFriendRequests() async {
        do {
            let fetched = try await APIService.shared.getFriendRequests()
            if friendRequests != fetched {
                friendRequests = fetched
            }
        } catch {
            // silently fail
        }
    }

    func loadFriends() async {
        // Only show the blocking loader on the very first load — subsequent
        // re-runs (e.g. tab re-appears after NavigationStack pop) shouldn't
        // flash a spinner over an already-populated list.
        let showLoader = friends.isEmpty
        if showLoader { isLoading = true }
        defer { isLoading = false }
        do {
            let fetched = try await APIService.shared.getFriendList()
            if friends != fetched {
                friends = fetched
                UserCacheManager.shared.cacheFriends(fetched)
            }
        } catch {
            if friends.isEmpty { errorMessage = "加载好友列表失败" }
        }
    }

    func sendFriendRequest(to userID: String) async {
        do {
            let msg = try await APIService.shared.sendFriendRequest(targetUserID: userID)
            successMessage = msg
            // Update search results
            if let idx = searchResults.firstIndex(where: { $0.userID == userID }) {
                let u = searchResults[idx]
                searchResults[idx] = SearchUser(
                    userID: u.userID,
                    nickname: u.nickname,
                    avatarURL: u.avatarURL,
                    relation: "pending_sent"
                )
            }
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "发送失败"
        }
    }

    func acceptRequest(_ request: FriendRequest) async {
        do {
            try await APIService.shared.acceptFriendRequest(requestID: request.requestID)
            friendRequests.removeAll { $0.id == request.id }
            successMessage = "已添加 \(request.nickname) 为好友"
            await loadFriends()
        } catch {
            errorMessage = "操作失败"
        }
    }

    func rejectRequest(_ request: FriendRequest) async {
        do {
            try await APIService.shared.rejectFriendRequest(requestID: request.requestID)
            friendRequests.removeAll { $0.id == request.id }
        } catch {
            errorMessage = "操作失败"
        }
    }
}
