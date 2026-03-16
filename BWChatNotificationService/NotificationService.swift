// BWChatNotificationService/NotificationService.swift
// Notification Service Extension for rich push notifications

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

        // Check for image URL in payload
        guard let imageURLString = request.content.userInfo["image_url"] as? String,
              let imageURL = URL(string: imageURLString),
              imageURL.scheme != nil else {
            contentHandler(bestAttemptContent)
            return
        }

        // Download image attachment (use public endpoint, no auth needed)
        downloadMedia(from: imageURL, fileExtension: "jpg") { attachment in
            if let attachment = attachment {
                bestAttemptContent.attachments = [attachment]
            }
            contentHandler(bestAttemptContent)
        }
    }

    override func serviceExtensionTimeWillExpire() {
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
