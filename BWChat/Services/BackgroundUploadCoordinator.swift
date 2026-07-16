import UIKit

/// Keeps user-initiated uploads alive after their originating SwiftUI screen disappears.
///
/// The current backend accepts media and creates the business object in one request, so
/// these operations cannot yet be restored after the process is killed. The coordinator
/// still gives an in-flight upload iOS background execution time and, more importantly,
/// makes upload ownership app-wide instead of view-wide.
@MainActor
final class BackgroundUploadCoordinator {
    static let shared = BackgroundUploadCoordinator()

    private var tasks: [String: Task<Void, Never>] = [:]
    private var backgroundTaskIDs: [String: UIBackgroundTaskIdentifier] = [:]

    private init() {}

    func enqueue(id: String, operation: @escaping @MainActor () async -> Void) {
        guard tasks[id] == nil else { return }

        let backgroundTaskID = UIApplication.shared.beginBackgroundTask(withName: id) { [weak self] in
            Task { @MainActor in
                self?.finish(id: id)
            }
        }
        backgroundTaskIDs[id] = backgroundTaskID

        tasks[id] = Task { [weak self] in
            await operation()
            self?.finish(id: id)
        }
    }

    func contains(id: String) -> Bool {
        tasks[id] != nil
    }

    private func finish(id: String) {
        tasks[id] = nil
        guard let backgroundTaskID = backgroundTaskIDs.removeValue(forKey: id),
              backgroundTaskID != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTaskID)
    }
}
