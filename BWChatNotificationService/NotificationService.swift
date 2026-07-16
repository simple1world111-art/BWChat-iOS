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

        rewriteStickerPreviewIfNeeded(bestAttemptContent)

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

    private func rewriteStickerPreviewIfNeeded(_ content: UNMutableNotificationContent) {
        let userInfo = content.userInfo
        let msgType = stringValue(userInfo["msg_type"])
            ?? stringValue(userInfo["message_type"])
            ?? stringValue(userInfo["last_message_type"])
        let candidates = [
            stringValue(userInfo["sticker_payload"]),
            stringValue(userInfo["content"]),
            stringValue(userInfo["message"]),
            stringValue(userInfo["last_message"]),
            content.body
        ].compactMap { $0 }

        let payload = candidates.compactMap(parseJSONObject).first { isStickerPayload($0) }
        let isSticker = msgType?.lowercased() == "sticker" || payload != nil
        guard isSticker else { return }

        let name = stickerDisplayName(userInfo: userInfo, payload: payload)
            ?? payload.flatMap(derivedStickerName(from:))
            ?? localizedStickerFallback()
        content.body = "[\(name)]"
    }

    private func stickerDisplayName(userInfo: [AnyHashable: Any], payload: [String: Any]?) -> String? {
        let direct = [
            stringValue(userInfo["sticker_name"]),
            stringValue(userInfo["sticker_display_name"]),
            stringValue(userInfo["display_name"]),
            stringValue(payload?["display_name"]),
            stringValue(payload?["title"]),
            stringValue(payload?["name"])
        ].compactMap { $0?.trimmedNonEmpty }.first
        if let direct {
            return direct
        }

        if let localized = payload?["name"] as? [String: Any] {
            return localizedString(from: localized)
        }
        if let localized = userInfo["sticker_name_i18n"] as? [String: Any] {
            return localizedString(from: localized)
        }
        return nil
    }

    private func localizedString(from values: [String: Any]) -> String? {
        let preferred = Locale.preferredLanguages.map { language in
            let id = Locale(identifier: language)
            var keys = [language, id.identifier]
            if let languageCode = id.language.languageCode?.identifier {
                keys.append(languageCode)
            }
            return keys
        }.flatMap { $0 }

        for key in preferred {
            if let value = stringValue(values[key])?.trimmedNonEmpty {
                return value
            }
        }

        return ["zh-Hans", "zh-Hant", "zh", "en"]
            .compactMap { stringValue(values[$0])?.trimmedNonEmpty }
            .first
    }

    private func derivedStickerName(from payload: [String: Any]) -> String? {
        let raw = stringValue(payload["sticker_id"])
            ?? stringValue(payload["asset_key"])
        guard let raw else { return nil }
        let lastComponent = raw
            .split(separator: "/")
            .last
            .map(String.init) ?? raw
        let normalized = lastComponent
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return nil }
        return normalized
            .split(separator: " ")
            .map { word in
                let lower = word.lowercased()
                return lower.prefix(1).uppercased() + lower.dropFirst()
            }
            .joined(separator: " ")
    }

    private func isStickerPayload(_ payload: [String: Any]) -> Bool {
        payload["sticker_id"] != nil || payload["stickerID"] != nil || payload["asset_key"] != nil
    }

    private func parseJSONObject(_ string: String) -> [String: Any]? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.first == "{",
              let data = trimmed.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return value
    }

    private func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private func localizedStickerFallback() -> String {
        let language = Locale.preferredLanguages.first?.lowercased() ?? ""
        if language.hasPrefix("zh") { return "表情" }
        if language.hasPrefix("ja") { return "スタンプ" }
        if language.hasPrefix("ko") { return "스티커" }
        return "Sticker"
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
