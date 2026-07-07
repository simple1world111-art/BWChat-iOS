// BWChat/ViewModels/MapDatingViewModel.swift
// Foreground-only location and nearby people state.

import CoreLocation
import Foundation

@MainActor
final class MapDatingViewModel: NSObject, ObservableObject {
    @Published var presence: MapPresence?
    @Published var mode: MapDatingMode = .nearby
    @Published var nearbyUsers: [MapUser] = []
    @Published var friendUsers: [MapUser] = []
    @Published var selectedUser: MapUser?
    @Published var selectedVisibilityScope: MapVisibilityScope = .everyone
    @Published var selectedOnlineStatus: MapOnlineStatus = .online
    @Published var draftStatusText = ""
    @Published var mapCenter: CLLocationCoordinate2D?
    @Published var radiusConstraints = MapRadiusConstraints.fallback
    @Published var nearbyEffectiveRadiusM: Int?
    @Published var friendEffectiveRadiusM: Int?
    @Published var isMapEnabled = false
    @Published var isLoading = false
    @Published var isUpdatingPresence = false
    @Published var isRefreshingLocation = false
    @Published var isRefreshingUsers = false
    @Published var errorMessage: String?
    @Published var successMessage: String?
    @Published var authorizationStatus: CLAuthorizationStatus

    private let locationManager = CLLocationManager()
    private var authorizationContinuation: CheckedContinuation<Bool, Never>?
    private var locationContinuation: CheckedContinuation<CLLocation?, Never>?
    private var locationTimeoutTimer: Timer?
    private var lastKnownLocation: CLLocation?
    private var lastUploadedLocation: CLLocation?
    private var lastUploadedAt: Date?
    private var uploadTimer: Timer?
    private var isUploadingLocation = false
    private var didLoadInitial = false

    override init() {
        self.authorizationStatus = locationManager.authorizationStatus
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = 100
        locationManager.pausesLocationUpdatesAutomatically = true
        locationManager.allowsBackgroundLocationUpdates = false
    }

    var displayedUsers: [MapUser] {
        guard canDisplayMapUsers else { return [] }
        switch mode {
        case .nearby: return nearbyUsers
        case .friends: return friendUsers
        }
    }

    var canDisplayMapUsers: Bool {
        isMapEnabled
    }

    var canUpdateLocation: Bool {
        isMapEnabled
    }

    var currentCoordinate: CLLocationCoordinate2D? {
        requestCoordinate
    }

    private var canUploadLocation: Bool {
        isMapEnabled && selectedOnlineStatus == .online
    }

    var enabledScopeText: String {
        selectedVisibilityScope.displayName
    }

    var presencePrompt: String? {
        if isMapEnabled && requestCoordinate == nil {
            return isRefreshingLocation ? L10n.tr("map.location.refreshing") : L10n.tr("map.location.required")
        }

        switch presence?.status {
        case "stale":
            return isRefreshingLocation ? L10n.tr("map.location.refreshing") : L10n.tr("map.location.expired")
        case "needs_location":
            return isUpdatingPresence ? L10n.tr("map.location.fetching") : L10n.tr("map.location.required")
        case "invisible":
            return L10n.tr("map.invisible.prompt")
        default:
            if selectedOnlineStatus == .invisible {
                return L10n.tr("map.invisible.prompt")
            }
            return nil
        }
    }

    var canRefreshPresenceLocation: Bool {
        !isUpdatingPresence
            && (requestCoordinate == nil || presence?.status == "stale" || presence?.status == "needs_location")
    }

    func loadInitial() async {
        guard !didLoadInitial else { return }
        didLoadInitial = true
        isLoading = true
        defer { isLoading = false }

        do {
            let presence = try await APIService.shared.getMapPresence()
            applyPresence(presence)
        } catch {
            errorMessage = apiMessage(error)
        }

        selectedVisibilityScope = .everyone
        selectedOnlineStatus = .online
        await setOnline()
    }

    func enableMapDating() async {
        await setOnlineStatus(selectedOnlineStatus)
    }

    func setOnlineStatus(_ status: MapOnlineStatus) async {
        guard !isUpdatingPresence else { return }
        switch status {
        case .online:
            await setOnline()
        case .invisible:
            await setInvisible()
        }
    }

    func refreshCurrentLocation() async {
        guard canUpdateLocation else { return }
        guard !isRefreshingLocation else { return }
        isRefreshingLocation = true
        defer { isRefreshingLocation = false }

        let granted = await requestLocationPermissionIfNeeded()
        guard granted else {
            errorMessage = L10n.tr("map.location.permissionRefreshRequired")
            return
        }

        guard let location = await requestCurrentLocation() else {
            errorMessage = L10n.tr("map.location.required")
            return
        }

        do {
            if canUploadLocation {
                try await uploadLocation(location, force: true)
            } else {
                applyLocalLocation(location)
                await refreshUsers()
            }
            successMessage = L10n.tr("map.location.refreshed")
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    private func setOnline() async {
        guard selectedVisibilityScope != .off else { return }
        let previousPresence = presence
        selectedOnlineStatus = .online
        applyPresence(
            localPresence(
                status: "needs_location",
                onlineStatus: MapOnlineStatus.online.rawValue,
                visibleOnMap: false,
                enabled: true
            ),
            forceOpen: true
        )
        isUpdatingPresence = true

        let granted = await requestLocationPermissionIfNeeded()
        guard granted else {
            if let previousPresence {
                applyPresence(previousPresence)
            } else {
                applyClosedState()
            }
            isUpdatingPresence = false
            errorMessage = L10n.tr("map.location.permissionEnableRequired")
            return
        }

        guard let location = await requestCurrentLocation() else {
            if let previousPresence {
                applyPresence(previousPresence)
            } else {
                applyClosedState()
            }
            isUpdatingPresence = false
            errorMessage = L10n.tr("map.location.required")
            return
        }

        do {
            let trimmedStatus = draftStatusText.trimmingCharacters(in: .whitespacesAndNewlines)
            let settings = try await APIService.shared.updateMapSettings(
                visibilityScope: selectedVisibilityScope,
                onlineStatus: MapOnlineStatus.online.rawValue,
                statusText: trimmedStatus.isEmpty ? nil : trimmedStatus
            )
            applyPresence(
                presenceForStatus(
                    from: settings,
                    status: settings.status == "active" ? "active" : "needs_location",
                    onlineStatus: .online,
                    visibleOnMap: settings.visibleOnMap,
                    enabled: true
                ),
                forceOpen: true
            )
            resumeForegroundUpdates()
            try await uploadLocation(location, force: true)

            isUpdatingPresence = false
            await refreshUsers()
        } catch {
            if let previousPresence {
                applyPresence(previousPresence)
            } else {
                applyClosedState()
            }
            isUpdatingPresence = false
            errorMessage = apiMessage(error)
        }
    }

    private func setInvisible() async {
        selectedOnlineStatus = .invisible
        let optimisticPresence = localPresence(
            status: "invisible",
            onlineStatus: MapOnlineStatus.invisible.rawValue,
            visibleOnMap: false,
            enabled: true
        )
        applyPresence(optimisticPresence, forceOpen: true)

        isUpdatingPresence = true

        do {
            let invisible = try await APIService.shared.updateMapSettings(
                onlineStatus: MapOnlineStatus.invisible.rawValue
            )
            applyPresence(
                presenceForStatus(
                    from: invisible,
                    status: "invisible",
                    onlineStatus: .invisible,
                    visibleOnMap: false,
                    enabled: true
                ),
                forceOpen: true
            )
            isUpdatingPresence = false

            let granted = await requestLocationPermissionIfNeeded()
            if granted {
                resumeForegroundUpdates()
                if let location = await requestCurrentLocation() {
                    applyLocalLocation(location)
                }
            }

            await refreshUsers()
            successMessage = L10n.tr("map.invisible.enabled")
        } catch {
            isUpdatingPresence = false
            applyPresence(optimisticPresence, forceOpen: true)
            let granted = await requestLocationPermissionIfNeeded()
            if granted {
                resumeForegroundUpdates()
                if let location = await requestCurrentLocation() {
                    applyLocalLocation(location)
                }
                await refreshUsers()
            }
            errorMessage = L10n.tr("map.invisible.syncFailed", apiMessage(error))
        }
    }

    func disableMapDating() async {
        stopForegroundUpdates()
        isMapEnabled = false
        selectedOnlineStatus = .invisible
        nearbyUsers = []
        friendUsers = []
        selectedUser = nil
        presence = MapPresence(
            enabled: false,
            visibilityScope: .off,
            onlineStatus: MapOnlineStatus.invisible.rawValue,
            visibleOnMap: false,
            status: "off"
        )

        isUpdatingPresence = true
        defer { isUpdatingPresence = false }

        do {
            let disabled = try await APIService.shared.disableMapPresence()
            applyPresence(disabled, forceOpen: false)
            nearbyUsers = []
            friendUsers = []
            successMessage = L10n.tr("map.disabled")
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    func refreshUsers() async {
        guard canDisplayMapUsers else {
            nearbyUsers = []
            friendUsers = []
            nearbyEffectiveRadiusM = nil
            friendEffectiveRadiusM = nil
            return
        }
        guard !isRefreshingUsers else { return }

        isRefreshingUsers = true
        defer { isRefreshingUsers = false }

        do {
            let coordinate = requestCoordinate
            switch mode {
            case .nearby:
                guard let coordinate else {
                    nearbyUsers = []
                    nearbyEffectiveRadiusM = nil
                    return
                }
                let response = try await APIService.shared.getNearbyMapUsers(
                    lat: coordinate.latitude,
                    lng: coordinate.longitude,
                    radiusM: queryRadiusM,
                    includeFriends: true
                )
                nearbyUsers = response.users
                applyUsersMetadata(response, for: .nearby)
            case .friends:
                let response = try await APIService.shared.getFriendMapUsers(
                    lat: coordinate?.latitude,
                    lng: coordinate?.longitude,
                    radiusM: coordinate == nil ? nil : queryRadiusM
                )
                friendUsers = response.users
                applyUsersMetadata(response, for: .friends)
            }
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    func selectUser(_ user: MapUser) async {
        selectedUser = user
        do {
            let coordinate = requestCoordinate
            selectedUser = try await APIService.shared.getMapUserDetail(
                userID: user.userID,
                lat: coordinate?.latitude,
                lng: coordinate?.longitude
            )
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    func sendFriendRequest(to user: MapUser) async {
        guard user.relation != "friend", user.relation != "pending_sent" else { return }
        do {
            _ = try await APIService.shared.sendFriendRequest(targetUserID: user.userID)
            replaceUser(user.replacingRelation("pending_sent"))
            successMessage = L10n.tr("addFriend.sent")
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    func blockUser(_ user: MapUser) async {
        do {
            try await APIService.shared.blockMapUser(userID: user.userID)
            nearbyUsers.removeAll { $0.userID == user.userID }
            friendUsers.removeAll { $0.userID == user.userID }
            selectedUser = nil
            successMessage = L10n.tr("map.block.success")
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    func unblockUser(_ user: MapUser) async {
        do {
            try await APIService.shared.unblockMapUser(userID: user.userID)
            replaceUser(user.replacingRelation(nil))
            successMessage = L10n.tr("map.unblock.success")
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    func reportUser(_ user: MapUser, reason: MapReportReason, detail: String? = nil) async {
        do {
            try await APIService.shared.reportMapUser(
                userID: user.userID,
                reason: reason.rawValue,
                detail: detail
            )
            successMessage = L10n.tr("map.report.submitted")
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    func resumeForegroundUpdates() {
        guard canUpdateLocation, isAuthorized else { return }
        locationManager.startUpdatingLocation()
        startUploadTimer()
    }

    func pauseForegroundUpdates() {
        locationManager.stopUpdatingLocation()
        stopUploadTimer()
    }

    private func stopForegroundUpdates() {
        locationManager.stopUpdatingLocation()
        stopUploadTimer()
    }

    private func applyPresence(_ presence: MapPresence, forceOpen: Bool? = nil) {
        self.presence = presence
        isMapEnabled = forceOpen ?? isFeatureOpen(presence)
        selectedVisibilityScope = presence.visibilityScope == .off ? selectedVisibilityScope : presence.visibilityScope
        if selectedVisibilityScope == .off {
            selectedVisibilityScope = .everyone
        }
        selectedOnlineStatus = MapOnlineStatus(rawValue: presence.onlineStatus)
            ?? (presence.status == "invisible" ? .invisible : .online)
        draftStatusText = presence.statusText ?? ""

        if lastKnownLocation == nil,
           let latitude = presence.latitude,
           let longitude = presence.longitude {
            mapCenter = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }

        if !canDisplayMapUsers {
            nearbyUsers = []
            friendUsers = []
        }
    }

    private func applyClosedState() {
        stopForegroundUpdates()
        isMapEnabled = false
        selectedOnlineStatus = .invisible
        nearbyUsers = []
        friendUsers = []
        selectedUser = nil
        presence = MapPresence(
            enabled: false,
            visibilityScope: .off,
            onlineStatus: MapOnlineStatus.invisible.rawValue,
            visibleOnMap: false,
            status: "off"
        )
    }

    private func applyLocalLocation(_ location: CLLocation) {
        lastKnownLocation = location
        mapCenter = location.coordinate
    }

    private func applyUsersMetadata(_ response: MapUsersResponseData, for mode: MapDatingMode) {
        if let constraints = response.constraints {
            radiusConstraints = constraints
        }
        switch mode {
        case .nearby:
            nearbyEffectiveRadiusM = response.effectiveRadiusM
        case .friends:
            friendEffectiveRadiusM = response.effectiveRadiusM
        }
    }

    private func isFeatureOpen(_ presence: MapPresence) -> Bool {
        switch presence.status {
        case "off":
            return false
        case "active", "invisible", "needs_location", "stale":
            return true
        default:
            return presence.enabled && presence.visibilityScope != .off
        }
    }

    private func localPresence(
        status: String,
        onlineStatus: String,
        visibleOnMap: Bool,
        enabled: Bool
    ) -> MapPresence {
        MapPresence(
            enabled: enabled,
            visibilityScope: selectedVisibilityScope,
            onlineStatus: onlineStatus,
            visibleOnMap: visibleOnMap,
            status: status,
            latitude: presence?.latitude,
            longitude: presence?.longitude,
            accuracyM: presence?.accuracyM,
            statusText: presence?.statusText ?? draftStatusText,
            updatedAt: presence?.updatedAt,
            expiresAt: presence?.expiresAt
        )
    }

    private func presenceForStatus(
        from presence: MapPresence,
        status: String,
        onlineStatus: MapOnlineStatus,
        visibleOnMap: Bool,
        enabled: Bool
    ) -> MapPresence {
        MapPresence(
            enabled: enabled,
            visibilityScope: presence.visibilityScope == .off ? selectedVisibilityScope : presence.visibilityScope,
            onlineStatus: onlineStatus.rawValue,
            visibleOnMap: visibleOnMap,
            status: status,
            latitude: presence.latitude ?? self.presence?.latitude,
            longitude: presence.longitude ?? self.presence?.longitude,
            accuracyM: presence.accuracyM ?? self.presence?.accuracyM,
            statusText: presence.statusText ?? draftStatusText,
            updatedAt: presence.updatedAt,
            expiresAt: presence.expiresAt
        )
    }

    private var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    private var requestCoordinate: CLLocationCoordinate2D? {
        if let location = lastKnownLocation {
            return location.coordinate
        }
        if let latitude = presence?.latitude, let longitude = presence?.longitude {
            return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }
        return nil
    }

    private var queryRadiusM: Int {
        min(
            max(radiusConstraints.defaultRadiusM, radiusConstraints.minRadiusM),
            radiusConstraints.maxRadiusM
        )
    }

    private func requestLocationPermissionIfNeeded() async -> Bool {
        authorizationStatus = locationManager.authorizationStatus

        switch authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                authorizationContinuation = continuation
                locationManager.requestWhenInUseAuthorization()
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }

    private func requestCurrentLocation(timeout: TimeInterval = 12) async -> CLLocation? {
        if let lastKnownLocation,
           abs(lastKnownLocation.timestamp.timeIntervalSinceNow) < 120,
           lastKnownLocation.horizontalAccuracy >= 0 {
            return lastKnownLocation
        }

        finishLocationRequest(with: nil)
        return await withCheckedContinuation { continuation in
            locationTimeoutTimer?.invalidate()
            locationContinuation = continuation
            locationManager.requestLocation()
            locationTimeoutTimer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if self.finishLocationRequest(with: nil) {
                        self.locationManager.stopUpdatingLocation()
                    }
                }
            }
        }
    }

    @discardableResult
    private func finishLocationRequest(with location: CLLocation?) -> Bool {
        guard let continuation = locationContinuation else { return false }
        locationContinuation = nil
        locationTimeoutTimer?.invalidate()
        locationTimeoutTimer = nil
        continuation.resume(returning: location)
        return true
    }

    private func uploadCurrentLocationIfNeeded(force: Bool) async {
        guard canUpdateLocation else { return }
        guard let location = lastKnownLocation else { return }
        do {
            if canUploadLocation {
                try await uploadLocation(location, force: force)
            } else if force || shouldUpload(location) {
                lastUploadedLocation = location
                lastUploadedAt = Date()
                await refreshUsers()
            }
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    private func uploadLocation(_ location: CLLocation, force: Bool) async throws {
        guard canUploadLocation else { return }
        if isUploadingLocation { return }
        if !force, !shouldUpload(location) { return }

        isUploadingLocation = true
        defer { isUploadingLocation = false }

        let updated = try await APIService.shared.updateMapLocation(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            accuracyM: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        )
        applyLocalLocation(location)
        lastUploadedLocation = location
        lastUploadedAt = Date()
        applyPresence(updated, forceOpen: true)
        await refreshUsers()
    }

    private func shouldUpload(_ location: CLLocation) -> Bool {
        guard let lastUploadedLocation, let lastUploadedAt else { return true }
        if location.distance(from: lastUploadedLocation) >= 100 { return true }
        return Date().timeIntervalSince(lastUploadedAt) >= 60
    }

    private func startUploadTimer() {
        stopUploadTimer()
        uploadTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { [weak self] in
                await self?.uploadCurrentLocationIfNeeded(force: true)
            }
        }
    }

    private func stopUploadTimer() {
        uploadTimer?.invalidate()
        uploadTimer = nil
    }

    private func replaceUser(_ user: MapUser) {
        if let index = nearbyUsers.firstIndex(where: { $0.userID == user.userID }) {
            nearbyUsers[index] = user
        }
        if let index = friendUsers.firstIndex(where: { $0.userID == user.userID }) {
            friendUsers[index] = user
        }
        if selectedUser?.userID == user.userID {
            selectedUser = user
        }
    }

    private func apiMessage(_ error: Error) -> String {
        if let apiError = error as? APIError {
            return apiError.errorDescription ?? L10n.tr("common.operationFailed")
        }
        return error.localizedDescription
    }
}

extension MapDatingViewModel: @preconcurrency CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        guard authorizationStatus != .notDetermined else { return }

        if let continuation = authorizationContinuation {
            authorizationContinuation = nil
            continuation.resume(returning: isAuthorized)
        }

        if isAuthorized {
            resumeForegroundUpdates()
        } else {
            pauseForegroundUpdates()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        applyLocalLocation(location)

        if finishLocationRequest(with: location) {
            return
        }

        Task {
            await uploadCurrentLocationIfNeeded(force: false)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if finishLocationRequest(with: nil) {
            return
        }
        errorMessage = L10n.tr("map.location.failed")
    }
}
