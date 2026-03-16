// BWChatNotificationService/NotificationService.swift
// Notification Service Extension for rich push notifications
// Runs even when the main app is killed — iOS launches this extension
// in a separate process for every incoming push with mutable-content: 1.

import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let bestAttemptContent = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        // For group messages, prepend group name to the title if available
        if let groupName = request.content.userInfo["group_name"] as? String {
            bestAttemptContent.title = groupName
        }

        // Download image attachment for rich notification preview (DM & group)
        guard let imageURLString = request.content.userInfo["image_url"] as? String,
              let imageURL = URL(string: imageURLString),
              imageURL.scheme != nil else {
            contentHandler(bestAttemptContent)
            return
        }

        // Determine file extension from URL
        let pathExt = imageURL.pathExtension.lowercased()
        let fileExtension = ["jpg", "jpeg", "png", "gif", "heic"].contains(pathExt)
            ? pathExt : "jpg"

        downloadMedia(from: imageURL, fileExtension: fileExtension) { attachment in
            if let attachment = attachment {
                bestAttemptContent.attachments = [attachment]
            }
            contentHandler(bestAttemptContent)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        // Deliver whatever we have before iOS kills us (30s limit)
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    private func downloadMedia(from url: URL, fileExtension: String, completion: @escaping (UNNotificationAttachment?) -> Void) {
        URLSession.shared.downloadTask(with: url) { localURL, response, error in
            guard let localURL = localURL, error == nil else {
                completion(nil)
                return
            }

            let tmpDir = FileManager.default.temporaryDirectory
            let tmpFile = tmpDir.appendingPathComponent(UUID().uuidString + "." + fileExtension)

            do {
                try FileManager.default.moveItem(at: localURL, to: tmpFile)
                let attachment = try UNNotificationAttachment(identifier: "media", url: tmpFile, options: nil)
                completion(attachment)
            } catch {
                completion(nil)
            }
        }.resume()
    }
}
