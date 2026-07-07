// BWChat/Services/ChatbotAPI.swift
// Chatbot client. Backend owns final prompt assembly and model selection.

import Foundation

struct ChatbotMessage: Codable {
    let role: String   // "user" | "assistant"
    let content: String
}

struct ChatbotRequest: Codable {
    let messages: [ChatbotMessage]
    let bot_id: String
}

struct ChatbotResponse: Codable {
    let content: String
    let finish_reason: String?
}

enum ChatbotError: LocalizedError {
    case network(String)
    case http(Int, String)
    case streamEnded(String)

    var errorDescription: String? {
        switch self {
        case .network(let m): return L10n.tr("chatbot.error.network", m)
        case .http(let code, let m):
            if m == L10n.tr("bot.currentNotFound") {
                return m
            }
            return L10n.tr("chatbot.error.service", code, m)
        case .streamEnded(let m): return m
        }
    }
}

@MainActor
final class ChatbotAPI {
    static let shared = ChatbotAPI()

    private var baseURL: URL {
        URL(string: AppConfig.apiBaseURL)!
    }

    private func makeRequest(path: String, acceptsStream: Bool) throws -> URLRequest {
        guard let token = AuthManager.shared.token else {
            throw ChatbotError.network(L10n.tr("api.unauthorized"))
        }

        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = acceptsStream ? 120 : 60
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        req.setValue(acceptsStream ? "text/event-stream" : "application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.assumesHTTP3Capable = false
        return req
    }

    private func chatbotError(from error: Error) -> Error {
        guard let urlError = error as? URLError else { return error }

        switch urlError.code {
        case .cannotFindHost:
            return ChatbotError.network(L10n.tr("chatbot.error.cannotFindHost", AppConfig.apiBaseURL))
        case .secureConnectionFailed:
            return ChatbotError.network(L10n.tr("chatbot.error.tlsFailed", AppConfig.apiBaseURL))
        case .timedOut:
            return ChatbotError.network(L10n.tr("chatbot.error.timeout", AppConfig.apiBaseURL))
        case .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet:
            return ChatbotError.network(urlError.localizedDescription)
        default:
            return ChatbotError.network(urlError.localizedDescription)
        }
    }

    private func errorMessage(from data: Data, fallback: String) -> String {
        let raw = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let normalizedRaw = normalizedErrorPayload(raw)
        let payloadData = normalizedRaw.data(using: .utf8) ?? data

        if let object = try? JSONSerialization.jsonObject(with: payloadData),
           let message = parsedErrorMessage(from: object) {
            return message
        }

        return normalizedRaw.isEmpty ? fallback : String(normalizedRaw.prefix(240))
    }

    private func normalizedErrorPayload(_ raw: String) -> String {
        let lines = raw
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                let text = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
                if text.hasPrefix("data: ") {
                    return String(text.dropFirst(6))
                }
                return text
            }
            .filter { !$0.isEmpty }

        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func parsedErrorMessage(from value: Any) -> String? {
        if let dict = value as? [String: Any] {
            if let code = dict["code"] as? Int, code == 2001 {
                return L10n.tr("bot.currentNotFound")
            }
            if let codeString = dict["code"] as? String, codeString == "2001" {
                return L10n.tr("bot.currentNotFound")
            }

            for key in ["detail", "message", "msg", "error"] {
                guard let child = dict[key] else { continue }
                if let message = parsedErrorMessage(from: child) {
                    return message
                }
            }

            return nil
        }

        if let array = value as? [Any] {
            for child in array {
                if let message = parsedErrorMessage(from: child) {
                    return message
                }
            }
            return nil
        }

        if let message = value as? String {
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return nil }
            if trimmed == "智能体不存在"
                || trimmed.localizedCaseInsensitiveContains("bot not found")
                || trimmed.localizedCaseInsensitiveContains("agent not found") {
                return L10n.tr("bot.currentNotFound")
            }
            return trimmed
        }

        return nil
    }

    private func debugLogRequest(_ req: URLRequest, body: ChatbotRequest) {
        #if DEBUG
        print("[Chatbot] POST \(req.url?.absoluteString ?? "<missing-url>")")
        print(
            "[Chatbot] payload botID=\(body.bot_id) messages=\(body.messages.count)"
        )
        #endif
    }

    private func debugLogHTTPError(statusCode: Int, message: String) {
        #if DEBUG
        print("[Chatbot] HTTP \(statusCode): \(message)")
        #endif
    }

    // MARK: - Non-streaming

    func send(
        messages: [ChatbotMessage],
        botID: String
    ) async throws -> String {
        var req = try makeRequest(path: "chatbot/chat", acceptsStream: false)

        let body = ChatbotRequest(
            messages: messages,
            bot_id: botID
        )
        req.httpBody = try JSONEncoder().encode(body)
        debugLogRequest(req, body: body)

        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await URLSession.shared.data(for: req)
        } catch {
            throw chatbotError(from: error)
        }

        guard let http = resp as? HTTPURLResponse else {
            throw ChatbotError.network(L10n.tr("api.invalidResponse"))
        }
        if !(200..<300).contains(http.statusCode) {
            let msg = errorMessage(from: data, fallback: L10n.tr("common.operationFailed"))
            debugLogHTTPError(statusCode: http.statusCode, message: msg)
            throw ChatbotError.http(http.statusCode, msg)
        }
        return try JSONDecoder().decode(ChatbotResponse.self, from: data).content
    }

    // MARK: - Streaming

    /// Stream chat deltas. `onDelta` is called on MainActor for each chunk.
    /// `onFinish` is called once with `nil` on success or the error message.
    /// Returns the task so callers can cancel.
    func stream(
        messages: [ChatbotMessage],
        botID: String,
        onDelta: @escaping @MainActor (String) -> Void,
        onFinish: @escaping @MainActor (Error?) -> Void
    ) -> Task<Void, Never> {
        Task { [weak self] in
            guard let self else { return }
            do {
                var req = try self.makeRequest(path: "chatbot/chat/stream", acceptsStream: true)

                let body = ChatbotRequest(
                    messages: messages,
                    bot_id: botID
                )
                req.httpBody = try JSONEncoder().encode(body)
                self.debugLogRequest(req, body: body)

                let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                guard let http = resp as? HTTPURLResponse else {
                    onFinish(ChatbotError.network(L10n.tr("api.invalidResponse")))
                    return
                }
                if !(200..<300).contains(http.statusCode) {
                    var errorLines: [String] = []
                    do {
                        for try await line in bytes.lines {
                            if !line.isEmpty {
                                errorLines.append(line)
                            }
                            if errorLines.count >= 8 { break }
                        }
                    } catch {
                        // The HTTP status is already enough to report a useful error.
                    }
                    let rawError = errorLines.joined(separator: "\n")
                    let data = Data(rawError.utf8)
                    let msg = self.errorMessage(
                        from: data,
                        fallback: rawError.isEmpty ? L10n.tr("chatbot.error.streamFailed") : rawError
                    )
                    self.debugLogHTTPError(statusCode: http.statusCode, message: msg)
                    onFinish(ChatbotError.http(http.statusCode, msg))
                    return
                }

                for try await line in bytes.lines {
                    if Task.isCancelled { return }
                    guard line.hasPrefix("data: ") else { continue }
                    let jsonStr = String(line.dropFirst(6))
                    guard let data = jsonStr.data(using: .utf8),
                          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                    else { continue }

                    if let err = obj["error"] as? String {
                        onFinish(ChatbotError.streamEnded(err))
                        return
                    }
                    if let delta = obj["delta"] as? String, !delta.isEmpty {
                        onDelta(delta)
                    }
                    if obj["done"] as? Bool == true {
                        onFinish(nil)
                        return
                    }
                }
                onFinish(nil)
            } catch {
                if (error as? CancellationError) != nil { return }
                onFinish(self.chatbotError(from: error))
            }
        }
    }
}
