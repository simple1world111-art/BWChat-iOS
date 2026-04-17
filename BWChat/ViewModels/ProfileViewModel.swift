// BWChat/ViewModels/ProfileViewModel.swift
// ViewModel for user profile management

import SwiftUI
import PhotosUI

@MainActor
class ProfileViewModel: ObservableObject {
    @Published var profile: User?
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var errorMessage: String?
    @Published var successMessage: String?

    // Edit fields
    @Published var editNickname = ""
    @Published var editBio = ""
    @Published var editGender = ""
    @Published var editBirthday = ""
    @Published var editLocation = ""
    @Published var editBirthdayDate = Date()

    init() {
        // Use cached user immediately so avatar shows without waiting for network
        if let cached = AuthManager.shared.currentUser {
            profile = cached
            populateEditFields(from: cached)
        }
    }

    func loadProfile() async {
        // Only show blocking loader on first load — otherwise tab re-appears
        // would flash a spinner over the already-rendered profile card.
        let showLoader = profile == nil
        if showLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }
        do {
            let user = try await APIService.shared.getMyProfile()
            if profile != user {
                profile = user
                populateEditFields(from: user)
                AuthManager.shared.updateUser(user)
            }
        } catch {
            if profile == nil { errorMessage = error.localizedDescription }
        }
    }

    func populateEditFields(from user: User) {
        editNickname = user.nickname
        editBio = user.bio
        editGender = user.gender
        editBirthday = user.birthday
        editLocation = user.location
        if !user.birthday.isEmpty {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            if let date = formatter.date(from: user.birthday) {
                editBirthdayDate = date
            }
        }
    }

    func saveProfile() async {
        isSaving = true
        errorMessage = nil
        successMessage = nil

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let birthdayStr = editBirthday.isEmpty ? "" : editBirthday

        do {
            let updated = try await APIService.shared.updateProfile(
                nickname: editNickname,
                bio: editBio,
                gender: editGender,
                birthday: birthdayStr,
                location: editLocation
            )
            profile = updated
            AuthManager.shared.updateUser(updated)
            successMessage = "保存成功"
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    func uploadAvatar(imageData: Data) async {
        isSaving = true
        errorMessage = nil
        do {
            let _ = try await APIService.shared.uploadAvatar(imageData: imageData, filename: "avatar.jpg")
            // Reload profile to get updated avatar URL
            await loadProfile()
            // Clear image cache so new avatar is fetched
            ImageCacheManager.shared.clearCache()
            successMessage = "头像更新成功"
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    func updateBirthdayFromDate() {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        editBirthday = formatter.string(from: editBirthdayDate)
    }
}
