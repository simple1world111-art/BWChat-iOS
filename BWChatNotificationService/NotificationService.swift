// BWChatNotificationService/NotificationService.swift
// Notification Service Extension for rich push notifications
// Runs even when the main app is killed — iOS launches this extension
// in a separate process for every incoming push with mutable-content: 1.

import ImageIO
import Intents
import UIKit
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?
    private let deliveryLock = NSLock()
    private var hasDelivered = false

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

        let userInfo = normalizedNotificationPayload(request.content.userInfo)
        bestAttemptContent.userInfo = userInfo
        let originalTitle = bestAttemptContent.title

        // For group messages, prepend group name to the title if available
        if let groupName = firstString(
            userInfo,
            keys: ["group_name", "conversation_name"]
        ) {
            bestAttemptContent.title = groupName
        }

        rewriteStickerPreviewIfNeeded(bestAttemptContent)
        rewriteMediaPreviewIfNeeded(bestAttemptContent)

        let communication = CommunicationInfo(
            userInfo: userInfo,
            fallbackTitle: originalTitle,
            body: bestAttemptContent.body
        )
        if let communication {
            if communication.isGroup {
                bestAttemptContent.title = communication.groupName
                    ?? communication.localizedGroupFallback
                bestAttemptContent.subtitle = ""
                bestAttemptContent.body = communication.intentBody
            } else {
                bestAttemptContent.title = communication.senderName
                bestAttemptContent.subtitle = ""
            }
        }

        downloadAssets(userInfo: userInfo, communication: communication) { [weak self] assets in
            guard let self else { return }
            if let attachment = assets.messageAttachment {
                bestAttemptContent.attachments = [attachment]
            }
            guard let communication else {
                self.deliver(bestAttemptContent)
                return
            }
            self.updateAsCommunicationNotification(
                bestAttemptContent,
                communication: communication,
                assets: assets
            )
        }
    }

    override func serviceExtensionTimeWillExpire() {
        // Deliver whatever we have before iOS kills us (30s limit)
        if let bestAttemptContent {
            deliver(bestAttemptContent)
        }
    }

    private func updateAsCommunicationNotification(
        _ content: UNMutableNotificationContent,
        communication: CommunicationInfo,
        assets: NotificationAssets
    ) {
        // For direct messages the visual identity is the sender. For group
        // messages the product design intentionally promotes the group itself
        // to the visual identity, so iOS renders the group avatar and name on
        // the first line while the actual sender remains in the message body.
        let visualIdentityID = communication.isGroup
            ? communication.intentGroupIdentifier
            : communication.intentSenderIdentifier
        let visualIdentityName = communication.isGroup
            ? (communication.intentGroupName ?? communication.localizedGroupFallback)
            : communication.intentSenderName
        let rawVisualIdentityImageData = communication.isGroup
            ? (
                assets.groupMemberAvatarData
                    ?? assets.groupAvatarData
                    ?? defaultGroupAvatarData()
            )
            : assets.senderAvatarData
        let visualIdentityImageData = rawVisualIdentityImageData.flatMap {
            squareCommunicationAvatarData(
                from: $0,
                cornerRadiusRatio: communication.isGroup ? 0.18 : 0.22,
                avatarScale: 1
            )
        } ?? rawVisualIdentityImageData
        let visualIdentityHandle = INPersonHandle(
            value: visualIdentityID,
            type: .unknown
        )
        let visualIdentityImage = visualIdentityImageData.map(INImage.init(imageData:))
        let visualIdentity = INPerson(
            personHandle: visualIdentityHandle,
            nameComponents: nil,
            displayName: visualIdentityName,
            image: visualIdentityImage,
            contactIdentifier: nil,
            customIdentifier: visualIdentityID
        )
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: communication.intentBody,
            speakableGroupName: nil,
            conversationIdentifier: communication.conversationID,
            serviceName: nil,
            sender: visualIdentity,
            attachments: nil
        )

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate { [weak self] _ in
            guard let self else { return }
            guard let provider = interaction.intent as? UNNotificationContentProviding,
                  let updatedContent = try? content.updating(from: provider) else {
                self.deliver(content)
                return
            }
            self.deliver(updatedContent)
        }
    }

    /// iOS applies a non-configurable circular mask and an app-icon badge to
    /// communication identities. Fill the complete avatar slot so that badge
    /// reads as an overlay instead of hanging from transparent outer padding.
    private func squareCommunicationAvatarData(
        from data: Data,
        cornerRadiusRatio: CGFloat,
        avatarScale: CGFloat
    ) -> Data? {
        guard let sourceImage = UIImage(data: data),
              sourceImage.size.width > 0,
              sourceImage.size.height > 0 else {
            return nil
        }

        let canvasSide: CGFloat = 256
        // Keep the source artwork's internal layout unchanged and scale the
        // complete direct or group avatar uniformly into the system slot.
        let avatarSide = canvasSide * avatarScale
        let avatarRect = CGRect(
            x: (canvasSide - avatarSide) / 2,
            y: (canvasSide - avatarSide) / 2,
            width: avatarSide,
            height: avatarSide
        )
        let scale = max(
            avatarRect.width / sourceImage.size.width,
            avatarRect.height / sourceImage.size.height
        )
        let drawSize = CGSize(
            width: sourceImage.size.width * scale,
            height: sourceImage.size.height * scale
        )
        let drawRect = CGRect(
            x: avatarRect.midX - drawSize.width / 2,
            y: avatarRect.midY - drawSize.height / 2,
            width: drawSize.width,
            height: drawSize.height
        )

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(
            size: CGSize(width: canvasSide, height: canvasSide),
            format: format
        ).image { _ in
            let clipPath = UIBezierPath(
                roundedRect: avatarRect,
                cornerRadius: avatarSide * cornerRadiusRatio
            )
            clipPath.addClip()
            sourceImage.draw(in: drawRect)
        }.pngData()
    }

    /// Communication notifications fall back to the App icon when a group
    /// image is absent or cannot be downloaded. Always provide a neutral group
    /// identity so group pushes never masquerade as an app-level alert.
    private func defaultGroupAvatarData() -> Data? {
        let canvasSize = CGSize(width: 256, height: 256)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true

        return UIGraphicsImageRenderer(size: canvasSize, format: format)
            .image { _ in
                UIColor(red: 1, green: 212 / 255, blue: 59 / 255, alpha: 1).setFill()
                UIBezierPath(
                    roundedRect: CGRect(origin: .zero, size: canvasSize),
                    cornerRadius: 54
                ).fill()

                let bubble = UIImage(
                    systemName: "bubble.left.fill",
                    withConfiguration: UIImage.SymbolConfiguration(
                        pointSize: 162,
                        weight: .regular
                    )
                )?.withTintColor(
                    UIColor(red: 23 / 255, green: 23 / 255, blue: 23 / 255, alpha: 1),
                    renderingMode: .alwaysOriginal
                )
                bubble?.draw(in: CGRect(x: 35, y: 42, width: 186, height: 166))

                let members = UIImage(
                    systemName: "person.2.fill",
                    withConfiguration: UIImage.SymbolConfiguration(
                        pointSize: 96,
                        weight: .bold
                    )
                )?.withTintColor(.white, renderingMode: .alwaysOriginal)
                members?.draw(in: CGRect(x: 69, y: 76, width: 118, height: 84))
            }
            .pngData()
    }

    private func downloadAssets(
        userInfo: [AnyHashable: Any],
        communication: CommunicationInfo?,
        completion: @escaping (NotificationAssets) -> Void
    ) {
        let senderAvatarURL = communication
            .flatMap { $0.isGroup ? nil : $0.senderAvatarValue }
            .flatMap(resolveRemoteURL)
        let groupAvatarURL = communication
            .flatMap(\.groupAvatarValue)
            .flatMap(resolveRemoteURL)
        let groupMemberAvatarValues = communication?.isGroup == true
            ? (communication?.groupMemberAvatarValues ?? [])
            : []
        // Only attach the server-generated lightweight preview. Downloading
        // the original image here delays the notification banner and defeats
        // the chat media contract (preview in the row, original on tap).
        let messageImageURL = firstRemoteURL(
            userInfo,
            keys: [
                "thumbnail_url", "thumbnailURL",
                "preview_url", "previewURL",
                "image_thumbnail_url", "video_thumbnail_url"
            ]
        )

        guard senderAvatarURL != nil
                || groupAvatarURL != nil
                || !groupMemberAvatarValues.isEmpty
                || messageImageURL != nil else {
            completion(NotificationAssets())
            return
        }

        let group = DispatchGroup()
        let resultLock = NSLock()
        var result = NotificationAssets()

        if let senderAvatarURL {
            group.enter()
            downloadImageData(from: senderAvatarURL) { data in
                resultLock.lock()
                result.senderAvatarData = data
                resultLock.unlock()
                group.leave()
            }
        }

        if let groupAvatarURL {
            group.enter()
            downloadImageData(from: groupAvatarURL) { data in
                resultLock.lock()
                result.groupAvatarData = data
                resultLock.unlock()
                group.leave()
            }
        }

        if !groupMemberAvatarValues.isEmpty {
            group.enter()
            downloadGroupMemberAvatarData(from: groupMemberAvatarValues) { data in
                resultLock.lock()
                result.groupMemberAvatarData = data
                resultLock.unlock()
                group.leave()
            }
        }

        if let messageImageURL {
            group.enter()
            downloadMedia(from: messageImageURL) { attachment in
                resultLock.lock()
                result.messageAttachment = attachment
                resultLock.unlock()
                group.leave()
            }
        }

        group.notify(queue: .global(qos: .userInitiated)) {
            resultLock.lock()
            let finalResult = result
            resultLock.unlock()
            completion(finalResult)
        }
    }

    private func downloadGroupMemberAvatarData(
        from values: [String],
        completion: @escaping (Data?) -> Void
    ) {
        let limitedValues = Array(values.prefix(9))
        guard !limitedValues.isEmpty else {
            completion(nil)
            return
        }

        let group = DispatchGroup()
        let imageLock = NSLock()
        var images = Array<UIImage?>(repeating: nil, count: limitedValues.count)

        for (index, value) in limitedValues.enumerated() {
            guard let url = resolveRemoteURL(value) else { continue }
            group.enter()
            downloadImageData(from: url) { data in
                let image = data.flatMap(UIImage.init(data:))
                imageLock.lock()
                images[index] = image
                imageLock.unlock()
                group.leave()
            }
        }

        group.notify(queue: .global(qos: .userInitiated)) { [weak self] in
            guard let self else {
                completion(nil)
                return
            }
            imageLock.lock()
            let finalImages = images.map { $0 ?? self.defaultMemberAvatarImage() }
            imageLock.unlock()
            completion(self.composeGroupMemberAvatarData(images: finalImages))
        }
    }

    /// Mirrors GroupMemberAvatarView exactly: up to nine members, 1/2/3
    /// columns, a shorter first row centered, 6% outer inset, 3% spacing,
    /// 18% group corner radius, and 22% member corner radius.
    private func composeGroupMemberAvatarData(images: [UIImage]) -> Data? {
        guard !images.isEmpty else { return nil }

        // ConversationRow renders GroupMemberAvatarView at exactly 50 points.
        // Keep the same logical coordinate system and only increase renderer
        // scale so every layout calculation (including floor()) is identical.
        let canvasSide: CGFloat = 50
        let outputPixelSide: CGFloat = 256
        let inset: CGFloat = 3
        let spacing: CGFloat = 1.5
        let columnCount: Int
        switch images.count {
        case 1:
            columnCount = 1
        case 2...4:
            columnCount = 2
        default:
            columnCount = 3
        }
        let memberSide = floor(
            (canvasSide - inset * 2 - spacing * CGFloat(columnCount - 1))
                / CGFloat(columnCount)
        )
        let firstRowCount = images.count % columnCount == 0
            ? columnCount
            : images.count % columnCount

        var rows: [[UIImage]] = []
        var start = 0
        var rowCount = firstRowCount
        while start < images.count {
            let end = min(images.count, start + rowCount)
            rows.append(Array(images[start..<end]))
            start = end
            rowCount = columnCount
        }

        let format = UIGraphicsImageRendererFormat()
        format.scale = outputPixelSide / canvasSide
        format.opaque = true
        return UIGraphicsImageRenderer(
            size: CGSize(width: canvasSide, height: canvasSide),
            format: format
        ).image { context in
            let canvasRect = CGRect(
                x: 0,
                y: 0,
                width: canvasSide,
                height: canvasSide
            )
            UIColor(
                red: 229 / 255,
                green: 229 / 255,
                blue: 234 / 255,
                alpha: 1
            ).setFill()
            UIBezierPath(
                roundedRect: canvasRect,
                cornerRadius: canvasSide * 0.18
            ).fill()

            let totalHeight = CGFloat(rows.count) * memberSide
                + CGFloat(max(0, rows.count - 1)) * spacing
            var y = (canvasSide - totalHeight) / 2

            for row in rows {
                let totalWidth = CGFloat(row.count) * memberSide
                    + CGFloat(max(0, row.count - 1)) * spacing
                var x = (canvasSide - totalWidth) / 2

                for image in row {
                    let memberRect = CGRect(
                        x: x,
                        y: y,
                        width: memberSide,
                        height: memberSide
                    )
                    context.cgContext.saveGState()
                    UIBezierPath(
                        roundedRect: memberRect,
                        cornerRadius: memberSide * 0.22
                    ).addClip()
                    drawAspectFill(image, in: memberRect)
                    context.cgContext.restoreGState()
                    x += memberSide + spacing
                }
                y += memberSide + spacing
            }
        }.pngData()
    }

    private func drawAspectFill(_ image: UIImage, in rect: CGRect) {
        let scale = max(
            rect.width / image.size.width,
            rect.height / image.size.height
        )
        let drawSize = CGSize(
            width: image.size.width * scale,
            height: image.size.height * scale
        )
        image.draw(
            in: CGRect(
                x: rect.midX - drawSize.width / 2,
                y: rect.midY - drawSize.height / 2,
                width: drawSize.width,
                height: drawSize.height
            )
        )
    }

    private func defaultMemberAvatarImage() -> UIImage {
        let side: CGFloat = 256
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(
            size: CGSize(width: side, height: side),
            format: format
        ).image { context in
            let colors = [
                UIColor(red: 102 / 255, green: 126 / 255, blue: 234 / 255, alpha: 1).cgColor,
                UIColor(red: 118 / 255, green: 75 / 255, blue: 162 / 255, alpha: 1).cgColor
            ] as CFArray
            if let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors,
                locations: [0, 1]
            ) {
                context.cgContext.drawLinearGradient(
                    gradient,
                    start: .zero,
                    end: CGPoint(x: side, y: side),
                    options: []
                )
            }

            let symbol = UIImage(
                systemName: "person.fill",
                withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: side * 0.38,
                    weight: .medium
                )
            )?.withTintColor(
                UIColor.white.withAlphaComponent(0.8),
                renderingMode: .alwaysOriginal
            )
            symbol?.draw(
                in: CGRect(
                    x: side * 0.31,
                    y: side * 0.31,
                    width: side * 0.38,
                    height: side * 0.38
                )
            )
        }
    }

    private func downloadImageData(from url: URL, completion: @escaping (Data?) -> Void) {
        let request = URLRequest(
            url: url,
            cachePolicy: .returnCacheDataElseLoad,
            timeoutInterval: 2
        )
        URLSession.shared.dataTask(with: request) { data, response, error in
            guard error == nil,
                  let data,
                  !data.isEmpty,
                  data.count <= 10 * 1_024 * 1_024,
                  let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  CGImageSourceCreateWithData(data as CFData, nil) != nil else {
                completion(nil)
                return
            }
            completion(data)
        }.resume()
    }

    private func downloadMedia(from url: URL, completion: @escaping (UNNotificationAttachment?) -> Void) {
        let pathExtension = url.pathExtension.lowercased()
        let fileExtension = ["jpg", "jpeg", "png", "gif", "heic", "webp"].contains(pathExtension)
            ? pathExtension : "jpg"

        downloadMedia(from: url, fileExtension: fileExtension, completion: completion)
    }

    private func downloadMedia(from url: URL, fileExtension: String, completion: @escaping (UNNotificationAttachment?) -> Void) {
        let request = URLRequest(
            url: url,
            cachePolicy: .returnCacheDataElseLoad,
            timeoutInterval: 2
        )
        URLSession.shared.downloadTask(with: request) { localURL, response, error in
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

    private func deliver(_ content: UNNotificationContent) {
        deliveryLock.lock()
        guard !hasDelivered else {
            deliveryLock.unlock()
            return
        }
        hasDelivered = true
        let handler = contentHandler
        contentHandler = nil
        deliveryLock.unlock()
        handler?(content)
    }

    private func firstRemoteURL(_ userInfo: [AnyHashable: Any], keys: [String]) -> URL? {
        for key in keys {
            guard let value = stringValue(userInfo[key])?.trimmedNonEmpty else { continue }
            if let url = resolveRemoteURL(value) { return url }
        }
        return nil
    }

    private func resolveRemoteURL(_ rawValue: String) -> URL? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        if let absoluteURL = URL(string: value),
           let scheme = absoluteURL.scheme?.lowercased(),
           (scheme == "https" || scheme == "http"),
           absoluteURL.host != nil {
            return absoluteURL
        }

        guard let baseURLString = Bundle.main.object(
            forInfoDictionaryKey: "BWChatAPIBaseURL"
        ) as? String,
              let baseURL = URL(string: baseURLString),
              let scheme = baseURL.scheme,
              let host = baseURL.host else {
            return nil
        }

        let resolvedString: String
        if value.hasPrefix("/api/") {
            var origin = "\(scheme)://\(host)"
            if let port = baseURL.port { origin += ":\(port)" }
            resolvedString = origin + value
        } else {
            resolvedString = baseURLString
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                + "/"
                + value.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }

        guard let resolvedURL = URL(string: resolvedString),
              let resolvedScheme = resolvedURL.scheme?.lowercased(),
              (resolvedScheme == "https" || resolvedScheme == "http"),
              resolvedURL.host != nil else {
            return nil
        }
        return resolvedURL
    }

    private func normalizedNotificationPayload(
        _ userInfo: [AnyHashable: Any]
    ) -> [AnyHashable: Any] {
        var result = userInfo
        // Legacy custom fields can exist at the top level while the canonical,
        // fresher message snapshot is nested. Let the canonical data win so a
        // renamed group doesn't keep displaying a stale top-level name/avatar.
        for containerKey in ["notification_data", "payload", "data"] {
            guard let nested = dictionaryValue(userInfo[containerKey]) else { continue }
            nested.forEach { key, value in
                result[key] = value
            }
        }
        return result
    }

    private func dictionaryValue(_ value: Any?) -> [String: Any]? {
        if let dictionary = value as? [String: Any] {
            return dictionary
        }
        if let dictionary = value as? [AnyHashable: Any] {
            return dictionary.reduce(into: [String: Any]()) { result, entry in
                guard let key = entry.key as? String else { return }
                result[key] = entry.value
            }
        }
        if let string = value as? String,
           let data = string.data(using: .utf8),
           let dictionary = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return dictionary
        }
        return nil
    }

    private func firstString(
        _ userInfo: [AnyHashable: Any],
        keys: [String]
    ) -> String? {
        for key in keys {
            if let value = stringValue(userInfo[key])?.trimmedNonEmpty {
                return value
            }
        }
        return nil
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

    /// Media endpoints commonly use the uploaded URL as message content and
    /// some push payloads therefore arrive with an empty alert body. An empty
    /// INSendMessageIntent content can be collapsed by iOS into a badge-only
    /// update, which is why photo/video messages appeared to have no banner.
    /// Normalize them to the same compact preview users see in the chat list.
    private func rewriteMediaPreviewIfNeeded(_ content: UNMutableNotificationContent) {
        let userInfo = content.userInfo
        let rawType = stringValue(userInfo["msg_type"])
            ?? stringValue(userInfo["message_type"])
            ?? stringValue(userInfo["last_message_type"])
        let messageType = rawType?
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")

        switch messageType {
        case "image", "photo", "picture":
            content.body = "[\(localizedMediaFallback(isVideo: false))]"
        case "video", "movie":
            content.body = "[\(localizedMediaFallback(isVideo: true))]"
        default:
            break
        }
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

    private func localizedMediaFallback(isVideo: Bool) -> String {
        let language = Locale.preferredLanguages.first?.lowercased() ?? ""
        if language.hasPrefix("zh-hant") {
            return isVideo ? "影片" : "圖片"
        }
        if language.hasPrefix("zh") {
            return isVideo ? "视频" : "图片"
        }
        if language.hasPrefix("ja") {
            return isVideo ? "動画" : "画像"
        }
        if language.hasPrefix("ko") {
            return isVideo ? "동영상" : "사진"
        }
        if language.hasPrefix("de") {
            return isVideo ? "Video" : "Bild"
        }
        if language.hasPrefix("es") {
            return isVideo ? "Video" : "Imagen"
        }
        if language.hasPrefix("fr") {
            return isVideo ? "Vidéo" : "Image"
        }
        if language.hasPrefix("pt") {
            return isVideo ? "Vídeo" : "Imagem"
        }
        if language.hasPrefix("ru") {
            return isVideo ? "Видео" : "Изображение"
        }
        return isVideo ? "Video" : "Photo"
    }
}

private struct NotificationAssets {
    var senderAvatarData: Data?
    var groupAvatarData: Data?
    var groupMemberAvatarData: Data?
    var messageAttachment: UNNotificationAttachment?
}

private struct CommunicationInfo {
    let senderID: String
    let senderName: String
    let isGroup: Bool
    let groupName: String?
    let conversationID: String
    let body: String
    let senderAvatarValue: String?
    let groupAvatarValue: String?
    let groupMemberAvatarValues: [String]
    let groupVisualRevision: String?

    var localizedGroupFallback: String {
        Self.localizedGroupFallback()
    }

    var intentSenderName: String {
        senderName
    }

    var intentSenderIdentifier: String {
        let visualSource = [
            "sender-full-bleed-v2",
            senderAvatarValue ?? ""
        ].joined(separator: "|")
        return "\(senderID):dm-visual:\(Self.stableFingerprint(visualSource))"
    }

    var intentGroupName: String? {
        isGroup ? (groupName ?? localizedGroupFallback) : nil
    }

    var intentGroupIdentifier: String {
        guard isGroup else { return "" }
        let visualSource = [
            "group-member-full-bleed-v8",
            groupName ?? "",
            groupAvatarValue ?? "",
            groupMemberAvatarValues.joined(separator: ","),
            groupVisualRevision ?? ""
        ].joined(separator: "|")
        return "\(conversationID):group-visual:\(Self.stableFingerprint(visualSource))"
    }

    var intentBody: String {
        guard isGroup else { return body }
        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedBody.isEmpty else { return senderName }

        let existingPrefixes = [
            "\(senderName):", "\(senderName)：",
            "\(senderName) :", "\(senderName) ："
        ]
        if existingPrefixes.contains(where: trimmedBody.hasPrefix) {
            return trimmedBody
        }
        return "\(senderName)：\(trimmedBody)"
    }

    init?(userInfo: [AnyHashable: Any], fallbackTitle: String, body: String) {
        guard let senderID = Self.firstString(
            userInfo,
            keys: ["sender_id", "senderId", "from_user_id", "fromUserId", "user_id"]
        ) else {
            return nil
        }

        let sender = Self.firstDictionary(
            userInfo,
            keys: [
                "sender", "sender_info", "sender_profile",
                "from_user", "message_sender"
            ]
        )
        let group = Self.firstDictionary(
            userInfo,
            keys: ["group"]
        )
        let conversation = Self.firstDictionary(
            userInfo,
            keys: ["conversation"]
        )
        let groupID = Self.firstString(userInfo, keys: ["group_id", "groupId"])
        let groupSpecificName = Self.firstString(
            userInfo,
            keys: ["group_name", "groupName"]
        ) ?? Self.firstString(
            group,
            keys: ["name", "group_name", "display_name", "title"]
        )
        let groupSpecificAvatar = Self.firstString(
            userInfo,
            keys: [
                "group_avatar_url", "group_avatar", "groupAvatarURL",
                "groupAvatarUrl", "groupAvatar"
            ]
        ) ?? Self.firstString(
            group,
            keys: ["avatar_url", "avatarURL", "avatarUrl", "avatar", "image_url"]
        )
        let isGroup = Self.isGroupConversation(
            userInfo,
            groupID: groupID,
            groupName: groupSpecificName,
            groupAvatar: groupSpecificAvatar,
            group: group
        )
        let explicitGroupName = groupSpecificName
            ?? Self.firstString(
                userInfo,
                keys: ["conversation_name", "conversationName"]
            )
            ?? Self.firstString(
                conversation,
                keys: ["name", "display_name", "title"]
            )
        let explicitGroupAvatar = groupSpecificAvatar
            ?? Self.firstString(
                userInfo,
                keys: ["conversation_avatar_url", "conversation_avatar"]
            )
            ?? Self.firstString(
                conversation,
                keys: ["avatar_url", "avatarURL", "avatarUrl", "avatar", "image_url"]
            )
        let safeFallbackTitle = fallbackTitle.trimmedNonEmpty.flatMap {
            $0 == senderID ? nil : $0
        }
        let explicitSenderName = Self.firstString(
            userInfo,
            keys: [
                "sender_name", "sender_nickname", "sender_display_name",
                "senderName", "senderNickname", "from_name",
                "nickname", "nick_name", "display_name"
            ]
        ) ?? Self.firstString(
            sender,
            keys: [
                "nickname", "nick_name", "display_name",
                "displayName", "name", "username"
            ]
        )
        let senderName = explicitSenderName
            ?? (isGroup ? nil : safeFallbackTitle)
            ?? Self.localizedMessageFallback(isGroup: isGroup)
        let groupName: String?
        if isGroup {
            groupName = explicitGroupName
                ?? Self.localizedGroupFallback()
        } else {
            groupName = nil
        }

        let explicitSenderAvatar = Self.firstString(
            userInfo,
            keys: [
                "sender_avatar_url", "sender_avatar", "senderAvatarURL",
                "senderAvatarUrl", "senderAvatar",
                "from_avatar_url", "from_avatar"
            ]
        ) ?? Self.firstString(
            sender,
            keys: [
                "avatar_url", "avatarURL", "avatarUrl",
                "avatar", "profile_image_url"
            ]
        )
        let genericAvatar = Self.firstString(
            userInfo,
            keys: ["avatar_url", "avatarURL", "avatarUrl", "avatar"]
        )
        let explicitConversationID = Self.firstString(
            userInfo,
            keys: ["conversation_id", "conversationId", "chat_id", "chatId"]
        )
        let groupVisualRevision = Self.firstString(
            userInfo,
            keys: [
                "group_revision", "groupRevision",
                "group_updated_at", "groupUpdatedAt",
                "conversation_revision", "conversationRevision"
            ]
        )
        let groupMemberAvatarValues = Self.firstAvatarArray(
            userInfo,
            keys: [
                "group_member_avatars", "group_member_avatar_urls",
                "groupMemberAvatars", "groupMemberAvatarURLs",
                "group_members", "groupMembers"
            ]
        ) ?? Self.firstAvatarArray(
            group,
            keys: [
                "member_avatars", "member_avatar_urls",
                "memberAvatars", "memberAvatarURLs", "members"
            ]
        ) ?? []

        self.senderID = senderID
        self.senderName = senderName
        self.isGroup = isGroup
        self.groupName = groupName
        if isGroup {
            self.conversationID = "group:\(groupID ?? explicitConversationID ?? "unknown")"
        } else {
            self.conversationID = "dm:\(explicitConversationID ?? senderID)"
        }
        self.body = body
        self.senderAvatarValue = explicitSenderAvatar ?? (isGroup ? nil : genericAvatar)
        self.groupAvatarValue = isGroup ? explicitGroupAvatar : nil
        self.groupMemberAvatarValues = isGroup
            ? Array(groupMemberAvatarValues.prefix(9))
            : []
        self.groupVisualRevision = isGroup ? groupVisualRevision : nil
    }

    private static func isGroupConversation(
        _ userInfo: [AnyHashable: Any],
        groupID: String?,
        groupName: String?,
        groupAvatar: String?,
        group: [String: Any]?
    ) -> Bool {
        let conversationType = firstString(
            userInfo,
            keys: [
                "conversation_type", "conversationType",
                "chat_type", "chatType", "scope"
            ]
        )?.lowercased()
        if let conversationType {
            if ["group", "group_chat", "groupchat"].contains(conversationType) {
                return true
            }
            if ["dm", "direct", "private", "private_chat", "single", "single_chat"]
                .contains(conversationType) {
                return false
            }
        }

        let pushType = firstString(
            userInfo,
            keys: ["push_type", "pushType", "type", "event_type", "eventType"]
        )?.lowercased()
        if let pushType {
            if [
                "group_message", "new_group_message",
                "group_chat_message", "group_mention"
            ].contains(pushType) {
                return true
            }
            if [
                "dm_message", "private_message", "direct_message"
            ].contains(pushType) {
                return false
            }
        }

        return groupID != nil || groupName != nil || groupAvatar != nil || group != nil
    }

    private static func firstString(
        _ userInfo: [AnyHashable: Any],
        keys: [String]
    ) -> String? {
        for key in keys {
            if let string = stringValue(userInfo[key])?.trimmedNonEmpty {
                return string
            }
        }
        return nil
    }

    private static func firstString(
        _ dictionary: [String: Any]?,
        keys: [String]
    ) -> String? {
        guard let dictionary else { return nil }
        for key in keys {
            if let string = stringValue(dictionary[key])?.trimmedNonEmpty {
                return string
            }
        }
        return nil
    }

    private static func firstDictionary(
        _ userInfo: [AnyHashable: Any],
        keys: [String]
    ) -> [String: Any]? {
        for key in keys {
            if let dictionary = userInfo[key] as? [String: Any] {
                return dictionary
            }
            if let string = userInfo[key] as? String,
               let data = string.data(using: .utf8),
               let dictionary = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return dictionary
            }
        }
        return nil
    }

    private static func firstAvatarArray(
        _ userInfo: [AnyHashable: Any],
        keys: [String]
    ) -> [String]? {
        for key in keys {
            if let values = avatarArrayValue(userInfo[key]) {
                return values
            }
        }
        return nil
    }

    private static func firstAvatarArray(
        _ dictionary: [String: Any]?,
        keys: [String]
    ) -> [String]? {
        guard let dictionary else { return nil }
        for key in keys {
            if let values = avatarArrayValue(dictionary[key]) {
                return values
            }
        }
        return nil
    }

    private static func avatarArrayValue(_ value: Any?) -> [String]? {
        let array: [Any]
        if let directArray = value as? [Any] {
            array = directArray
        } else if let string = value as? String,
                  let data = string.data(using: .utf8),
                  let decoded = try? JSONSerialization.jsonObject(with: data) as? [Any] {
            array = decoded
        } else {
            return nil
        }

        guard !array.isEmpty else { return nil }
        return array.map { item in
            if let value = stringValue(item) {
                return value.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            guard let member = item as? [String: Any] else { return "" }
            return firstString(
                member,
                keys: [
                    "avatar_url", "avatarURL", "avatarUrl",
                    "avatar", "profile_image_url"
                ]
            ) ?? ""
        }
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func stableFingerprint(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(hash, radix: 16)
    }

    private static func localizedMessageFallback(isGroup: Bool) -> String {
        let language = Locale.preferredLanguages.first?.lowercased() ?? ""
        if language.hasPrefix("zh") { return isGroup ? "群消息" : "新消息" }
        if language.hasPrefix("ja") { return isGroup ? "グループメッセージ" : "新しいメッセージ" }
        if language.hasPrefix("ko") { return isGroup ? "그룹 메시지" : "새 메시지" }
        return isGroup ? "Group message" : "New message"
    }

    private static func localizedGroupFallback() -> String {
        let language = Locale.preferredLanguages.first?.lowercased() ?? ""
        if language.hasPrefix("zh") { return "群聊" }
        if language.hasPrefix("ja") { return "グループ" }
        if language.hasPrefix("ko") { return "그룹" }
        return "Group"
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
