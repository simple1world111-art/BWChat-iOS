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

    private static func birthdayFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    private static func defaultBirthdayDate() -> Date {
        Calendar(identifier: .gregorian).date(byAdding: .year, value: -18, to: Date()) ?? Date()
    }

    private static func birthdayString(from date: Date) -> String {
        birthdayFormatter().string(from: date)
    }

    private static func birthdayDate(from rawValue: String) -> Date? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let formatter = birthdayFormatter()
        if let date = formatter.date(from: trimmed) {
            return date
        }
        if trimmed.count >= 10 {
            return formatter.date(from: String(trimmed.prefix(10)))
        }
        return nil
    }

    private static func normalizedBirthdayString(_ rawValue: String) -> String {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if let date = birthdayDate(from: trimmed) {
            return birthdayString(from: date)
        }
        return trimmed
    }

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
        editBirthday = Self.normalizedBirthdayString(user.birthday)
        editLocation = user.location
        editBirthdayDate = Self.birthdayDate(from: editBirthday) ?? Self.defaultBirthdayDate()
    }

    func saveProfile() async {
        isSaving = true
        errorMessage = nil
        successMessage = nil

        let birthdayStr = normalizedBirthdayForSave()

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
            successMessage = L10n.tr("profile.saveSuccess")
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
            successMessage = L10n.tr("profile.avatar.updated")
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    func updateBirthdayFromDate() {
        editBirthday = Self.birthdayString(from: editBirthdayDate)
    }

    func setBirthdayDate(_ date: Date) {
        editBirthdayDate = date
        updateBirthdayFromDate()
    }

    func clearBirthday() {
        editBirthday = ""
        editBirthdayDate = Self.defaultBirthdayDate()
    }

    private func normalizedBirthdayForSave() -> String {
        let trimmed = editBirthday.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if let date = Self.birthdayDate(from: trimmed) {
            return Self.birthdayString(from: date)
        }
        return Self.birthdayString(from: editBirthdayDate)
    }
}
