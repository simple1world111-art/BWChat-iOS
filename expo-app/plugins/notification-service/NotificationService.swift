// BWChatNotificationService/NotificationService.swift
// Notification Service Extension for rich push notifications
// Runs even when the main app is killed — iOS launches this extension
// in a separate process for every incoming push with mutable-content: 1.

import ImageIO
import Intents
import UIKit
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    private let maximumAssetBytes = 1_024 * 1_024
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?
    private let deliveryLock = NSLock()
    private var hasDelivered = false
    private lazy var assetPolicy = NotificationAssetPolicy(bundle: .main)
    private lazy var assetSessionDelegate = SecureAssetSessionDelegate(
        policy: assetPolicy,
        maximumBytes: maximumAssetBytes
    )
    private lazy var assetSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.timeoutIntervalForRequest = 2
        configuration.timeoutIntervalForResource = 2
        return URLSession(
            configuration: configuration,
            delegate: assetSessionDelegate,
            delegateQueue: nil
        )
    }()

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
        let handlesAsOrdinaryMessage = shouldNormalizeMessageInterruption(userInfo)
        if handlesAsOrdinaryMessage {
            // Fail closed before identity parsing: malformed ordinary message
            // payloads must not inherit Time Sensitive/Critical from APNs.
            // Only explicitly typed call/security events retain their level.
            bestAttemptContent.interruptionLevel = .active
        }
        bestAttemptContent.title = notificationDisplayTextWithoutPreviewSuffix(
            bestAttemptContent.title
        )
        bestAttemptContent.subtitle = notificationDisplayTextWithoutPreviewSuffix(
            bestAttemptContent.subtitle
        )
        let originalTitle = bestAttemptContent.title

        rewriteStickerPreviewIfNeeded(bestAttemptContent)
        rewriteMediaPreviewIfNeeded(bestAttemptContent)

        let communication = handlesAsOrdinaryMessage
            ? CommunicationInfo(
                userInfo: userInfo,
                fallbackTitle: originalTitle,
                body: bestAttemptContent.body
            )
            : nil
        if let communication {
            bestAttemptContent.title = communication.displayTitle
            bestAttemptContent.subtitle = ""
            bestAttemptContent.body = communication.intentBody
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
            guard communication.surface.supportsCommunicationIntent else {
                // AI agents and scripted characters are app content, not
                // people. Keep their explicit label and optional artwork,
                // but never donate an INPerson/INSendMessageIntent identity.
                if bestAttemptContent.attachments.isEmpty,
                   let artworkData = self.plainNotificationArtworkData(
                       communication: communication,
                       assets: assets
                   ),
                   let artwork = self.imageAttachment(
                       data: artworkData,
                       identifier: "conversation-artwork"
                   ) {
                    bestAttemptContent.attachments = [artwork]
                }
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
        // Keep people and conversations semantically separate. Apple derives
        // a direct-message avatar from `sender`, while a group avatar belongs
        // to `speakableGroupName` and must never masquerade as a person.
        let senderIdentityID: String
        let senderIdentityName: String
        let rawSenderImageData: Data?
        switch communication.surface {
        case .dm:
            senderIdentityID = communication.intentSenderIdentifier
            senderIdentityName = communication.senderName
            rawSenderImageData = assets.senderAvatarData
                ?? defaultMemberAvatarImage().pngData()
        case .group:
            senderIdentityID = communication.intentSenderIdentifier
            senderIdentityName = communication.senderName
            rawSenderImageData = assets.senderAvatarData
                ?? defaultMemberAvatarImage().pngData()
        case .agent, .script:
            // Callers gate this function to real person-to-person surfaces.
            // Fail closed if a future call bypasses that gate.
            deliver(content)
            return
        }
        let senderImageData = rawSenderImageData.flatMap {
            squareCommunicationAvatarData(
                from: $0,
                cornerRadiusRatio: communication.surface == .script ? 0.18 : 0.22,
                avatarScale: 1
            )
        } ?? rawSenderImageData
        let senderHandle = INPersonHandle(
            value: senderIdentityID,
            type: .unknown
        )
        let senderImage = senderImageData.map(INImage.init(imageData:))
        let intentSender = INPerson(
            personHandle: senderHandle,
            nameComponents: nil,
            displayName: senderIdentityName,
            image: senderImage,
            contactIdentifier: nil,
            customIdentifier: senderIdentityID
        )

        let speakableGroupName = communication.surface == .group
            ? INSpeakableString(spokenPhrase: communication.conversationName)
            : nil
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: communication.intentBody,
            speakableGroupName: speakableGroupName,
            conversationIdentifier: communication.conversationID,
            serviceName: nil,
            sender: intentSender,
            attachments: nil
        )
        if communication.surface == .group {
            // A real group icon is authoritative. The member mosaic is only
            // a fallback when the backend has no group artwork.
            let rawGroupImageData = assets.groupAvatarData
                ?? assets.groupMemberAvatarData
                ?? defaultGroupAvatarData()
            let groupImageData = rawGroupImageData.flatMap {
                squareCommunicationAvatarData(
                    from: $0,
                    cornerRadiusRatio: 0.18,
                    avatarScale: 1
                )
            } ?? rawGroupImageData
            if let groupImageData {
                intent.setImage(INImage(imageData: groupImageData), forParameterNamed: \.speakableGroupName)
            }
        }

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

    private func defaultAgentAvatarData() -> Data? {
        defaultSurfaceAvatarData(
            colors: [
                UIColor(red: 92 / 255, green: 74 / 255, blue: 238 / 255, alpha: 1),
                UIColor(red: 56 / 255, green: 189 / 255, blue: 248 / 255, alpha: 1)
            ],
            systemName: "sparkles"
        )
    }

    private func defaultScriptAvatarData() -> Data? {
        defaultSurfaceAvatarData(
            colors: [
                UIColor(red: 236 / 255, green: 72 / 255, blue: 153 / 255, alpha: 1),
                UIColor(red: 249 / 255, green: 115 / 255, blue: 22 / 255, alpha: 1)
            ],
            systemName: "theatermasks.fill"
        )
    }

    private func defaultSurfaceAvatarData(
        colors: [UIColor],
        systemName: String
    ) -> Data? {
        let canvasSize = CGSize(width: 256, height: 256)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: canvasSize, format: format).image { context in
            let cgColors = colors.map(\.cgColor) as CFArray
            if let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: cgColors,
                locations: [0, 1]
            ) {
                context.cgContext.drawLinearGradient(
                    gradient,
                    start: .zero,
                    end: CGPoint(x: canvasSize.width, y: canvasSize.height),
                    options: []
                )
            }
            let symbol = UIImage(
                systemName: systemName,
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 132, weight: .semibold)
            )?.withTintColor(.white, renderingMode: .alwaysOriginal)
            symbol?.draw(in: CGRect(x: 62, y: 62, width: 132, height: 132))
        }.pngData()
    }

    private func plainNotificationArtworkData(
        communication: CommunicationInfo,
        assets: NotificationAssets
    ) -> Data? {
        switch communication.surface {
        case .agent:
            return assets.senderAvatarData ?? defaultAgentAvatarData()
        case .script:
            return assets.groupAvatarData ?? defaultScriptAvatarData()
        case .dm, .group:
            return nil
        }
    }

    private func imageAttachment(data: Data, identifier: String) -> UNNotificationAttachment? {
        guard !data.isEmpty,
              data.count <= maximumAssetBytes,
              let normalizedData = UIImage(data: data)?.pngData(),
              normalizedData.count <= maximumAssetBytes else {
            return nil
        }
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("png")
        do {
            try normalizedData.write(to: fileURL, options: .atomic)
            return try UNNotificationAttachment(
                identifier: identifier,
                url: fileURL,
                options: nil
            )
        } catch {
            return nil
        }
    }

    private func downloadAssets(
        userInfo: [AnyHashable: Any],
        communication: CommunicationInfo?,
        completion: @escaping (NotificationAssets) -> Void
    ) {
        let senderAvatarURL = communication
            .flatMap { $0.surface.usesSenderArtwork ? $0.senderAvatarValue : nil }
            .flatMap(resolveRemoteURL)
        let groupAvatarURL = communication
            .flatMap { $0.surface.usesConversationArtwork ? $0.groupAvatarValue : nil }
            .flatMap(resolveRemoteURL)
        let groupMemberAvatarValues = communication?.surface == .group
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
        let task = assetSession.dataTask(with: request)
        assetSessionDelegate.register(task: task, completion: completion)
        task.resume()
    }

    private func downloadMedia(from url: URL, completion: @escaping (UNNotificationAttachment?) -> Void) {
        let pathExtension = url.pathExtension.lowercased()
        let fileExtension = ["jpg", "jpeg", "png", "gif", "heic", "webp"].contains(pathExtension)
            ? pathExtension : "jpg"

        downloadImageData(from: url) { data in
            guard let data else {
                completion(nil)
                return
            }

            let tmpDir = FileManager.default.temporaryDirectory
            let tmpFile = tmpDir.appendingPathComponent(UUID().uuidString + "." + fileExtension)

            do {
                try data.write(to: tmpFile, options: .atomic)
                let attachment = try UNNotificationAttachment(identifier: "media", url: tmpFile, options: nil)
                completion(attachment)
            } catch {
                completion(nil)
            }
        }
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
           absoluteURL.scheme != nil,
           assetPolicy.allows(absoluteURL) {
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
              assetPolicy.allows(resolvedURL) else {
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

private enum NotificationSurface: String {
    case dm
    case group
    case agent
    case script

    var supportsCommunicationIntent: Bool {
        self == .dm || self == .group
    }

    var usesSenderArtwork: Bool {
        self == .dm || self == .group || self == .agent
    }

    var usesConversationArtwork: Bool {
        self == .group || self == .script
    }

    static func resolve(
        userInfo: [AnyHashable: Any],
        hasLegacyGroupIdentity: Bool
    ) -> NotificationSurface {
        if let explicit = CommunicationInfo.firstString(
            userInfo,
            keys: ["surface_type", "surfaceType"]
        ).flatMap(Self.from) {
            return explicit
        }

        if let pushType = CommunicationInfo.firstString(
            userInfo,
            keys: ["push_type", "pushType", "type", "event_type", "eventType"]
        )?.lowercased() {
            if ["agent_message", "new_agent_message", "ai_message"].contains(pushType) {
                return .agent
            }
            if ["script_message", "script_room_message", "new_script_message", "role_message"]
                .contains(pushType) {
                return .script
            }
            if ["group_message", "new_group_message", "group_chat_message", "group_mention"]
                .contains(pushType) {
                return .group
            }
            if ["dm_message", "private_message", "direct_message", "new_message"]
                .contains(pushType) {
                return .dm
            }
        }

        if let legacy = CommunicationInfo.firstString(
            userInfo,
            keys: [
                "conversation_type", "conversationType",
                "chat_type", "chatType", "scope"
            ]
        ).flatMap(Self.from) {
            return legacy
        }
        return hasLegacyGroupIdentity ? .group : .dm
    }

    private static func from(_ rawValue: String) -> NotificationSurface? {
        switch rawValue.lowercased().replacingOccurrences(of: "-", with: "_") {
        case "dm", "direct", "private", "private_chat", "single", "single_chat":
            return .dm
        case "group", "group_chat", "groupchat":
            return .group
        case "agent", "agent_chat", "ai", "ai_agent":
            return .agent
        case "script", "script_room", "script_chat", "roleplay":
            return .script
        default:
            return nil
        }
    }
}

private struct CommunicationInfo {
    let surface: NotificationSurface
    let senderID: String
    let senderName: String
    let conversationName: String
    let conversationID: String
    let body: String
    let senderAvatarValue: String?
    let groupAvatarValue: String?
    let groupMemberAvatarValues: [String]
    let visualRevision: String?

    var displayTitle: String {
        switch surface {
        case .dm:
            return senderName
        case .group:
            return conversationName
        case .agent, .script:
            return Self.labeledTitle(surface: surface, name: conversationName)
        }
    }

    var intentSenderIdentifier: String {
        let senderSource = [
            "sender-full-bleed-v10",
            senderID,
            senderName,
            senderAvatarValue ?? "",
            visualRevision ?? ""
        ].joined(separator: "|")
        return "\(senderID):visual:\(Self.stableFingerprint(senderSource))"
    }

    var intentBody: String {
        guard surface == .script else { return body }
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
        let sender = Self.firstDictionary(
            userInfo,
            keys: ["sender", "sender_info", "sender_profile", "from_user", "message_sender"]
        )
        let group = Self.firstDictionary(userInfo, keys: ["group"])
        let agent = Self.firstDictionary(userInfo, keys: ["agent", "agent_info"])
        let script = Self.firstDictionary(
            userInfo,
            keys: ["script", "script_room", "script_info"]
        )
        let conversation = Self.firstDictionary(userInfo, keys: ["conversation"])

        let groupID = Self.firstString(userInfo, keys: ["group_id", "groupId"])
        let groupName = Self.firstString(userInfo, keys: ["group_name", "groupName"])
            ?? Self.firstString(group, keys: ["name", "group_name", "display_name", "title"])
        let groupAvatar = Self.firstString(
            userInfo,
            keys: ["group_avatar_url", "group_avatar", "groupAvatarURL", "groupAvatarUrl"]
        ) ?? Self.firstString(
            group,
            keys: ["avatar_url", "avatarURL", "avatarUrl", "avatar", "image_url"]
        )
        let surface = NotificationSurface.resolve(
            userInfo: userInfo,
            hasLegacyGroupIdentity: groupID != nil
                || groupName != nil
                || groupAvatar != nil
                || group != nil
        )

        let explicitConversationID = Self.firstString(
            userInfo,
            keys: ["conversation_id", "conversationId", "chat_id", "chatId"]
        )
        let conversationKey = Self.firstString(
            userInfo,
            keys: ["conversation_key", "conversationKey", "thread_id", "threadId"]
        )
        let genericSurfaceID = Self.firstString(
            userInfo,
            keys: ["surface_id", "surfaceId"]
        )
        let agentID = Self.firstString(
            userInfo,
            keys: ["agent_conversation_id", "agentConversationId", "agent_id", "agentId"]
        ) ?? Self.firstString(agent, keys: ["conversation_id", "id", "agent_id"])
        let scriptID = Self.firstString(
            userInfo,
            keys: ["script_room_id", "scriptRoomId", "script_id", "scriptId"]
        ) ?? Self.firstString(script, keys: ["room_id", "id", "script_id"])
        let keySurfaceID = Self.surfaceID(from: conversationKey, surface: surface)
        let surfaceID: String?
        switch surface {
        case .dm:
            surfaceID = genericSurfaceID ?? keySurfaceID ?? explicitConversationID
        case .group:
            surfaceID = genericSurfaceID ?? keySurfaceID ?? groupID ?? explicitConversationID
        case .agent:
            surfaceID = genericSurfaceID ?? keySurfaceID ?? agentID ?? explicitConversationID
        case .script:
            surfaceID = genericSurfaceID ?? keySurfaceID ?? scriptID ?? explicitConversationID ?? groupID
        }

        let explicitSenderID = Self.firstString(
            userInfo,
            keys: ["sender_id", "senderId", "from_user_id", "fromUserId", "user_id"]
        )
        let senderID = explicitSenderID
            ?? (surface == .agent ? agentID : nil)
            ?? surfaceID
        guard let senderID else { return nil }

        let safeFallbackTitle = notificationDisplayTextWithoutPreviewSuffix(fallbackTitle)
            .trimmedNonEmpty.flatMap { $0 == senderID ? nil : $0 }
        let senderName = (
            Self.firstString(
                userInfo,
                keys: [
                    "sender_name", "sender_nickname", "sender_display_name",
                    "senderName", "senderNickname", "from_name",
                    "nickname", "nick_name", "display_name"
                ]
            ) ?? Self.firstString(
                sender,
                keys: ["nickname", "nick_name", "display_name", "displayName", "name", "username"]
            )
        ).map(notificationDisplayTextWithoutPreviewSuffix)
            ?? (surface == .dm ? safeFallbackTitle : nil)
            ?? Self.localizedMessageFallback(isGroup: surface == .group || surface == .script)

        let genericConversationName = Self.firstString(
            userInfo,
            keys: ["conversation_name", "conversationName"]
        ) ?? Self.firstString(conversation, keys: ["name", "display_name", "title"])
        let agentName = Self.firstString(
            userInfo,
            keys: ["agent_name", "agentName", "agent_display_name"]
        ) ?? Self.firstString(agent, keys: ["name", "display_name", "title"])
        let scriptName = Self.firstString(
            userInfo,
            keys: ["script_name", "scriptName", "script_room_name", "script_title"]
        ) ?? Self.firstString(script, keys: ["name", "display_name", "title"])
        let rawConversationName: String?
        switch surface {
        case .dm:
            rawConversationName = senderName
        case .group:
            rawConversationName = groupName ?? genericConversationName
        case .agent:
            rawConversationName = agentName ?? genericConversationName ?? safeFallbackTitle
        case .script:
            rawConversationName = scriptName ?? genericConversationName ?? groupName ?? safeFallbackTitle
        }
        let conversationName = rawConversationName
            .map(notificationDisplayTextWithoutPreviewSuffix)
            ?? Self.localizedConversationFallback(surface)

        let senderAvatar = Self.firstString(
            userInfo,
            keys: [
                "sender_avatar_url", "sender_avatar", "senderAvatarURL",
                "senderAvatarUrl", "senderAvatar", "from_avatar_url", "from_avatar"
            ]
        ) ?? Self.firstString(
            sender,
            keys: ["avatar_url", "avatarURL", "avatarUrl", "avatar", "profile_image_url"]
        )
        let conversationAvatar = Self.firstString(
            userInfo,
            keys: ["conversation_avatar_url", "conversation_avatar"]
        ) ?? Self.firstString(
            conversation,
            keys: ["avatar_url", "avatarURL", "avatarUrl", "avatar", "image_url"]
        )
        let genericAvatar = Self.firstString(
            userInfo,
            keys: ["avatar_url", "avatarURL", "avatarUrl", "avatar"]
        )
        let agentAvatar = Self.firstString(
            userInfo,
            keys: ["agent_avatar_url", "agent_avatar", "agentAvatarURL", "agentAvatar"]
        ) ?? Self.firstString(
            agent,
            keys: ["avatar_url", "avatarURL", "avatarUrl", "avatar", "image_url"]
        )
        let scriptAvatar = Self.firstString(
            userInfo,
            keys: [
                "script_avatar_url", "script_avatar", "script_cover_url",
                "script_icon_url", "scriptAvatarURL", "scriptCoverURL"
            ]
        ) ?? Self.firstString(
            script,
            keys: ["avatar_url", "cover_url", "icon_url", "image_url"]
        )
        let senderAvatarValue: String?
        let conversationAvatarValue: String?
        switch surface {
        case .dm:
            senderAvatarValue = senderAvatar ?? genericAvatar
            conversationAvatarValue = nil
        case .group:
            senderAvatarValue = senderAvatar ?? genericAvatar
            conversationAvatarValue = groupAvatar ?? conversationAvatar
        case .agent:
            senderAvatarValue = agentAvatar ?? conversationAvatar ?? senderAvatar ?? genericAvatar
            conversationAvatarValue = nil
        case .script:
            senderAvatarValue = nil
            conversationAvatarValue = scriptAvatar ?? conversationAvatar ?? groupAvatar
        }

        let groupMemberAvatarValues = Self.firstAvatarArray(
            userInfo,
            keys: [
                "group_member_avatars", "group_member_avatar_urls",
                "groupMemberAvatars", "groupMemberAvatarURLs", "group_members", "groupMembers"
            ]
        ) ?? Self.firstAvatarArray(
            group,
            keys: [
                "member_avatars", "member_avatar_urls",
                "memberAvatars", "memberAvatarURLs", "members"
            ]
        ) ?? []
        let visualRevision = Self.firstString(
            userInfo,
            keys: [
                "avatar_version", "avatarVersion", "group_revision", "groupRevision",
                "group_updated_at", "groupUpdatedAt",
                "conversation_revision", "conversationRevision"
            ]
        )

        let canonicalSurfaceID = surfaceID ?? senderID
        self.surface = surface
        self.senderID = senderID
        self.senderName = senderName
        self.conversationName = conversationName
        self.conversationID = "\(surface.rawValue):\(canonicalSurfaceID)"
        self.body = body
        self.senderAvatarValue = senderAvatarValue
        self.groupAvatarValue = conversationAvatarValue
        self.groupMemberAvatarValues = surface == .group
            ? Array(groupMemberAvatarValues.prefix(9))
            : []
        self.visualRevision = visualRevision
    }

    private static func surfaceID(
        from conversationKey: String?,
        surface: NotificationSurface
    ) -> String? {
        guard let conversationKey else { return nil }
        let prefix = "\(surface.rawValue):"
        guard conversationKey.lowercased().hasPrefix(prefix) else { return nil }
        return String(conversationKey.dropFirst(prefix.count)).trimmedNonEmpty
    }

    fileprivate static func firstString(
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

    private static func localizedConversationFallback(
        _ surface: NotificationSurface
    ) -> String {
        let language = Locale.preferredLanguages.first?.lowercased() ?? ""
        switch surface {
        case .dm:
            return localizedMessageFallback(isGroup: false)
        case .group:
            if language.hasPrefix("zh") { return "群聊" }
            if language.hasPrefix("ja") { return "グループ" }
            if language.hasPrefix("ko") { return "그룹" }
            return "Group"
        case .agent:
            if language.hasPrefix("zh") { return "智能体" }
            if language.hasPrefix("ja") { return "AIエージェント" }
            if language.hasPrefix("ko") { return "AI 에이전트" }
            return "AI Agent"
        case .script:
            if language.hasPrefix("zh") { return "剧本" }
            if language.hasPrefix("ja") { return "シナリオ" }
            if language.hasPrefix("ko") { return "시나리오" }
            return "Script"
        }
    }

    private static func labeledTitle(
        surface: NotificationSurface,
        name: String
    ) -> String {
        let label = localizedConversationFallback(surface)
        let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalizedName == label || normalizedName.hasPrefix("\(label) ·") {
            return normalizedName
        }
        return "\(label) · \(normalizedName)"
    }
}

private struct NotificationAssetPolicy {
    private let allowedHosts: Set<String>

    init(bundle: Bundle) {
        var hosts = Set(
            (bundle.object(forInfoDictionaryKey: "BWChatAllowedAssetHosts") as? [String] ?? [])
                .compactMap { $0.trimmedNonEmpty?.lowercased() }
        )
        if let baseURLString = bundle.object(forInfoDictionaryKey: "BWChatAPIBaseURL") as? String,
           let baseURL = URL(string: baseURLString),
           let host = baseURL.host?.lowercased() {
            hosts.insert(host)
        }
        allowedHosts = hosts
    }

    func allows(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.user == nil,
              url.password == nil,
              let host = url.host?.lowercased(),
              allowedHosts.contains(host) else {
            return false
        }
        return true
    }
}

private final class SecureAssetSessionDelegate: NSObject, URLSessionDataDelegate {
    private struct Transfer {
        var data = Data()
        var acceptedResponse = false
        let completion: (Data?) -> Void
    }

    private let policy: NotificationAssetPolicy
    private let maximumBytes: Int
    private let transferLock = NSLock()
    private var transfers: [Int: Transfer] = [:]

    init(policy: NotificationAssetPolicy, maximumBytes: Int) {
        self.policy = policy
        self.maximumBytes = maximumBytes
    }

    func register(task: URLSessionDataTask, completion: @escaping (Data?) -> Void) {
        transferLock.lock()
        transfers[task.taskIdentifier] = Transfer(completion: completion)
        transferLock.unlock()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let url = request.url, policy.allows(url) else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode),
              httpResponse.expectedContentLength < 0
                || httpResponse.expectedContentLength <= Int64(maximumBytes),
              let finalURL = httpResponse.url,
              policy.allows(finalURL),
              httpResponse.mimeType?.lowercased().hasPrefix("image/") == true else {
            finish(taskIdentifier: dataTask.taskIdentifier, data: nil)
            completionHandler(.cancel)
            return
        }

        transferLock.lock()
        if var transfer = transfers[dataTask.taskIdentifier] {
            transfer.acceptedResponse = true
            transfers[dataTask.taskIdentifier] = transfer
        }
        transferLock.unlock()
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        var exceededLimit = false
        var failureCompletion: ((Data?) -> Void)?
        transferLock.lock()
        if var transfer = transfers[dataTask.taskIdentifier], transfer.acceptedResponse {
            if data.count > maximumBytes - transfer.data.count {
                failureCompletion = transfers
                    .removeValue(forKey: dataTask.taskIdentifier)?
                    .completion
                exceededLimit = true
            } else {
                transfer.data.append(data)
                transfers[dataTask.taskIdentifier] = transfer
            }
        }
        transferLock.unlock()

        guard exceededLimit else { return }
        // Cancel as soon as the accumulated response crosses 1 MB. This
        // bounds memory/network use while the response is still arriving.
        failureCompletion?(nil)
        dataTask.cancel()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        transferLock.lock()
        let transfer = transfers.removeValue(forKey: task.taskIdentifier)
        transferLock.unlock()
        guard let transfer else { return }

        guard error == nil,
              transfer.acceptedResponse,
              !transfer.data.isEmpty,
              transfer.data.count <= maximumBytes,
              CGImageSourceCreateWithData(transfer.data as CFData, nil) != nil else {
            transfer.completion(nil)
            return
        }
        transfer.completion(transfer.data)
    }

    private func finish(taskIdentifier: Int, data: Data?) {
        transferLock.lock()
        let transfer = transfers.removeValue(forKey: taskIdentifier)
        transferLock.unlock()
        transfer?.completion(data)
    }
}

/// Preview identifies the deployment channel, not the person or group. Strip
/// only a trailing environment label and preserve normal names such as
/// "Preview Club" as well as message bodies containing the same word.
private func notificationDisplayTextWithoutPreviewSuffix(_ value: String) -> String {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let range = normalized.range(
        of: #"(?:\s+|[-–—·|｜]\s*|\(\s*|（\s*|\[\s*|【\s*)preview\s*(?:\)|）|\]|】)?$"#,
        options: [.regularExpression, .caseInsensitive]
    ) else {
        return normalized
    }
    let cleaned = String(normalized[..<range.lowerBound])
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? normalized : cleaned
}

private func shouldNormalizeMessageInterruption(_ userInfo: [AnyHashable: Any]) -> Bool {
    let explicitType = CommunicationInfo.firstString(
        userInfo,
        keys: ["push_type", "pushType", "type", "event_type", "eventType", "category"]
    )?
        .lowercased()
        .replacingOccurrences(of: "-", with: "_")
        .replacingOccurrences(of: " ", with: "_")
    guard let explicitType else {
        // Missing identities/types are treated as an ordinary notification;
        // lack of metadata must never grant elevated interruption priority.
        return true
    }
    let elevatedTypes: Set<String> = [
        "call", "call_invite", "group_call", "group_call_invite",
        "account_security", "safety_alert", "security", "security_alert"
    ]
    return !elevatedTypes.contains(explicitType)
}

private extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
