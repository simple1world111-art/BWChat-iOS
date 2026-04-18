// BWChat/Services/ChatbotAPI.swift
// Qwen3-32B chat client. Streaming (SSE) + non-streaming.

import Foundation

struct ChatbotMessage: Codable {
    let role: String   // "user" | "assistant"
    let content: String
}

struct ChatbotRequest: Codable {
    let messages: [ChatbotMessage]
    let persona: String?
    let system: String?
    let temperature: Double
    let max_tokens: Int
    let top_p: Double
    let enable_thinking: Bool
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
        case .network(let m): return "网络错误：\(m)"
        case .http(let code, let m): return "服务错误 \(code)：\(m)"
        case .streamEnded(let m): return m
        }
    }
}

@MainActor
final class ChatbotAPI {
    static let shared = ChatbotAPI()

    private var baseURL: URL {
        URL(string: AppConfig.chatbotBaseURL)!
    }

    // MARK: - Non-streaming

    func send(
        messages: [ChatbotMessage],
        persona: String?,
        system: String?,
        temperature: Double,
        maxTokens: Int,
        topP: Double,
        enableThinking: Bool
    ) async throws -> String {
        var req = URLRequest(url: baseURL.appendingPathComponent("v1/chat"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 60

        let body = ChatbotRequest(
            messages: messages,
            persona: persona?.isEmpty == true ? nil : persona,
            system: system?.isEmpty == true ? nil : system,
            temperature: temperature,
            max_tokens: maxTokens,
            top_p: topP,
            enable_thinking: enableThinking
        )
        req.httpBody = try JSONEncoder().encode(body)

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw ChatbotError.network("无响应")
        }
        if !(200..<300).contains(http.statusCode) {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data)["detail"]) ?? ""
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
        persona: String?,
        system: String?,
        temperature: Double,
        maxTokens: Int,
        topP: Double,
        enableThinking: Bool,
        onDelta: @escaping @MainActor (String) -> Void,
        onFinish: @escaping @MainActor (Error?) -> Void
    ) -> Task<Void, Never> {
        Task { [weak self] in
            guard let self else { return }
            do {
                var req = URLRequest(url: self.baseURL.appendingPathComponent("v1/chat/stream"))
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                req.timeoutInterval = 60

                let body = ChatbotRequest(
                    messages: messages,
                    persona: persona?.isEmpty == true ? nil : persona,
                    system: system?.isEmpty == true ? nil : system,
                    temperature: temperature,
                    max_tokens: maxTokens,
                    top_p: topP,
                    enable_thinking: enableThinking
                )
                req.httpBody = try JSONEncoder().encode(body)

                let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                guard let http = resp as? HTTPURLResponse else {
                    await onFinish(ChatbotError.network("无响应"))
                    return
                }
                if !(200..<300).contains(http.statusCode) {
                    await onFinish(ChatbotError.http(http.statusCode, "stream 请求失败"))
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
                        await onFinish(ChatbotError.streamEnded(err))
                        return
                    }
                    if let delta = obj["delta"] as? String, !delta.isEmpty {
                        await onDelta(delta)
                    }
                    if obj["done"] as? Bool == true {
                        await onFinish(nil)
                        return
                    }
                }
                await onFinish(nil)
            } catch {
                if (error as? CancellationError) != nil { return }
                await onFinish(error)
            }
        }
    }
}
