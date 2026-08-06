// BWChat/Services/LoginLocationRecorder.swift
// Records a fresh, device-provided location after an explicit login.

import CoreLocation
import Foundation

enum MapLocationRecordSource: String {
    case login
    case mapVisit = "map_visit"
    case foregroundUpdate = "foreground_update"
}

enum MapLocationQualityPolicy {
    static let maximumAge: TimeInterval = 30
    static let maximumHorizontalAccuracy: CLLocationAccuracy = 100

    static func isUsable(_ location: CLLocation, now: Date = Date()) -> Bool {
        guard CLLocationCoordinate2DIsValid(location.coordinate),
              location.horizontalAccuracy >= 0,
              location.horizontalAccuracy <= maximumHorizontalAccuracy,
              abs(now.timeIntervalSince(location.timestamp)) <= maximumAge else {
            return false
        }
        return abs(location.coordinate.latitude) > 0.000001
            || abs(location.coordinate.longitude) > 0.000001
    }
}

@MainActor
final class LoginLocationRecorder: NSObject {
    static let shared = LoginLocationRecorder()

    private let locationManager = CLLocationManager()
    private var authorizationContinuation: CheckedContinuation<Bool, Never>?
    private var locationContinuation: CheckedContinuation<CLLocation?, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var recordingUserID: String?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = false
    }

    func recordAfterLogin(userID: String) async {
        let normalizedUserID = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserID.isEmpty, recordingUserID == nil else { return }
        guard AuthManager.shared.currentUser?.userID == normalizedUserID,
              AuthManager.shared.isLoggedIn else { return }

        recordingUserID = normalizedUserID
        defer { recordingUserID = nil }

        guard await requestPermissionIfNeeded(),
              AuthManager.shared.currentUser?.userID == normalizedUserID,
              AuthManager.shared.isLoggedIn,
              let location = await requestFreshLocation(),
              MapLocationQualityPolicy.isUsable(location),
              AuthManager.shared.currentUser?.userID == normalizedUserID,
              AuthManager.shared.isLoggedIn else {
            return
        }

        do {
            _ = try await APIService.shared.updateMapLocation(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                accuracyM: location.horizontalAccuracy,
                source: .login,
                eventID: UUID().uuidString,
                recordedAt: location.timestamp
            )
        } catch {
            #if DEBUG
            print("[MapLocation] login upload failed user_id=\(normalizedUserID) error=\(error.localizedDescription)")
            #endif
        }
    }

    private var isAuthorized: Bool {
        let status = locationManager.authorizationStatus
        return status == .authorizedWhenInUse || status == .authorizedAlways
    }

    private func requestPermissionIfNeeded() async -> Bool {
        switch locationManager.authorizationStatus {
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

    private func requestFreshLocation() async -> CLLocation? {
        finishLocationRequest(with: nil)
        return await withCheckedContinuation { continuation in
            locationContinuation = continuation
            locationManager.startUpdatingLocation()
            timeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 12_000_000_000)
                guard !Task.isCancelled else { return }
                self?.finishLocationRequest(with: nil)
            }
        }
    }

    private func finishLocationRequest(with location: CLLocation?) {
        guard let continuation = locationContinuation else { return }
        locationContinuation = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        locationManager.stopUpdatingLocation()
        continuation.resume(returning: location)
    }
}

extension LoginLocationRecorder: @preconcurrency CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined,
              let continuation = authorizationContinuation else {
            return
        }
        authorizationContinuation = nil
        continuation.resume(returning: isAuthorized)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let bestLocation = locations
            .filter { MapLocationQualityPolicy.isUsable($0) }
            .min { $0.horizontalAccuracy < $1.horizontalAccuracy }
        guard let bestLocation else { return }
        finishLocationRequest(with: bestLocation)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finishLocationRequest(with: nil)
    }
}
