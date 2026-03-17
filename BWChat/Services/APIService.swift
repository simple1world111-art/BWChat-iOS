// BWChat/Services/APIService.swift
// HTTP API service using URLSession

import Foundation

enum APIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case serverError(code: Int, message: String)
    case networkError(Error)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "无效的请求地址"
        case .invalidResponse: return "服务器响应异常"
        case .unauthorized: return "登录已过期"
        case .serverError(_, let message): return message
        case .networkError(let error): return "网络连接失败: \(error.localizedDescription)"
        case .decodingError: return "数据解析失败"
        }
    }
}

struct APIResponseWrapper<T: Decodable>: Decodable {
    let code: Int
    let message: String
    let data: T?
}

struct EmptyData: Decodable {}

@MainActor
class APIService {
    static let shared = APIService()
    private let session: URLSession
    private let baseURL: String

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        self.session = URLSession(configuration: config)
        self.baseURL = AppConfig.apiBaseURL
    }

    // MARK: - Auth

    func login(username: String, password: String, deviceToken: String? = nil) async throws -> (String, User) {
        var body: [String: Any] = [
            "username": username,
            "password": password,
        ]
        if let token = deviceToken {
            body["device_token"] = token
        }

        struct LoginData: Decodable {
            let token: String
            let user: User
        }

        let response: APIResponseWrapper<LoginData> = try await postJSON(path: "/auth/login", body: body, auth: false)
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return (data.token, data.user)
    }

    func verifyToken() async throws -> User {
        struct VerifyData: Decodable {
            let user: User
        }

        let response: APIResponseWrapper<VerifyData> = try await get(path: "/auth/verify")
        guard let data = response.data else {
            throw APIError.unauthorized
        }
        return data.user
    }

    func logout() async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/auth/logout", body: [:])
    }

    // MARK: - Contacts

    func getContacts() async throws -> [Contact] {
        struct ContactsData: Decodable {
            let contacts: [Contact]
        }

        let response: APIResponseWrapper<ContactsData> = try await get(path: "/chat/contacts")
        return response.data?.contacts ?? []
    }

    // MARK: - Messages

    func getMessages(contactID: String, beforeID: Int? = nil, limit: Int = 30) async throws -> ([Message], Bool) {
        struct MessagesData: Decodable {
            let messages: [Message]
            let hasMore: Bool

            enum CodingKeys: String, CodingKey {
                case messages
                case hasMore = "has_more"
            }
        }

        var queryItems = [URLQueryItem]()
        if let beforeID = beforeID {
            queryItems.append(URLQueryItem(name: "before_id", value: "\(beforeID)"))
        }
        queryItems.append(URLQueryItem(name: "limit", value: "\(limit)"))

        let response: APIResponseWrapper<MessagesData> = try await get(
            path: "/chat/messages/\(contactID)",
            queryItems: queryItems
        )
        let data = response.data
        return (data?.messages ?? [], data?.hasMore ?? false)
    }

    func markMessagesAsRead(contactID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/chat/messages/\(contactID)/read",
            body: [:]
        )
    }

    func markGroupMessagesAsRead(groupID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/messages/read",
            body: [:]
        )
    }

    func sendTextMessage(receiverID: String, content: String) async throws -> Message {
        let body: [String: Any] = [
            "receiver_id": receiverID,
            "content": content,
        ]

        let response: APIResponseWrapper<Message> = try await postJSON(path: "/chat/messages/text", body: body)
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendImageMessage(receiverID: String, imageData: Data, filename: String) async throws -> Message {
        let response: APIResponseWrapper<Message> = try await uploadImage(
            path: "/chat/messages/image",
            fieldName: "receiver_id",
            fieldValue: receiverID,
            imageData: imageData,
            filename: filename
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendVideoMessage(receiverID: String, videoData: Data, filename: String) async throws -> Message {
        let response: APIResponseWrapper<Message> = try await uploadVideo(
            path: "/chat/messages/video",
            fieldName: "receiver_id",
            fieldValue: receiverID,
            videoData: videoData,
            filename: filename
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    // MARK: - Friends

    func searchUsers(keyword: String) async throws -> [SearchUser] {
        struct SearchData: Decodable {
            let users: [SearchUser]
        }

        let response: APIResponseWrapper<SearchData> = try await get(
            path: "/friends/search",
            queryItems: [URLQueryItem(name: "keyword", value: keyword)]
        )
        return response.data?.users ?? []
    }

    func getFriendList() async throws -> [FriendInfo] {
        struct FriendListData: Decodable {
            let friends: [FriendInfo]
        }

        let response: APIResponseWrapper<FriendListData> = try await get(path: "/friends/list")
        return response.data?.friends ?? []
    }

    func getFriendRequests() async throws -> [FriendRequest] {
        struct RequestsData: Decodable {
            let requests: [FriendRequest]
        }

        let response: APIResponseWrapper<RequestsData> = try await get(path: "/friends/requests")
        return response.data?.requests ?? []
    }

    func sendFriendRequest(targetUserID: String) async throws -> String {
        let body: [String: Any] = ["target_user_id": targetUserID]
        let response: APIResponseWrapper<EmptyData> = try await postJSON(path: "/friends/request", body: body)
        return response.message
    }

    func acceptFriendRequest(requestID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/friends/requests/\(requestID)/accept",
            body: [:]
        )
    }

    func rejectFriendRequest(requestID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/friends/requests/\(requestID)/reject",
            body: [:]
        )
    }

    // MARK: - Groups

    func getGroups() async throws -> [ChatGroup] {
        struct GroupsData: Decodable {
            let groups: [ChatGroup]
        }

        let response: APIResponseWrapper<GroupsData> = try await get(path: "/groups/list")
        return response.data?.groups ?? []
    }

    func createGroup(name: String, memberIDs: [String]) async throws {
        let body: [String: Any] = ["name": name, "member_ids": memberIDs]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/groups/create", body: body)
    }

    func getGroupMessages(groupID: Int, beforeID: Int? = nil) async throws -> ([GroupMessage], Bool) {
        struct GroupMessagesData: Decodable {
            let messages: [GroupMessage]
            let hasMore: Bool

            enum CodingKeys: String, CodingKey {
                case messages
                case hasMore = "has_more"
            }
        }

        var queryItems = [URLQueryItem]()
        if let beforeID = beforeID {
            queryItems.append(URLQueryItem(name: "before_id", value: "\(beforeID)"))
        }

        let response: APIResponseWrapper<GroupMessagesData> = try await get(
            path: "/groups/\(groupID)/messages",
            queryItems: queryItems
        )
        let data = response.data
        return (data?.messages ?? [], data?.hasMore ?? false)
    }

    func sendGroupText(groupID: Int, content: String) async throws -> GroupMessage {
        let body: [String: Any] = ["content": content]
        let response: APIResponseWrapper<GroupMessage> = try await postJSON(
            path: "/groups/\(groupID)/messages/text",
            body: body
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendGroupImage(groupID: Int, imageData: Data, filename: String) async throws -> GroupMessage {
        let response: APIResponseWrapper<GroupMessage> = try await uploadImage(
            path: "/groups/\(groupID)/messages/image",
            fieldName: nil,
            fieldValue: nil,
            imageData: imageData,
            filename: filename
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendGroupVideo(groupID: Int, videoData: Data, filename: String) async throws -> GroupMessage {
        let response: APIResponseWrapper<GroupMessage> = try await uploadVideo(
            path: "/groups/\(groupID)/messages/video",
            fieldName: nil,
            fieldValue: nil,
            videoData: videoData,
            filename: filename
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func getGroupDetail(groupID: Int) async throws -> GroupDetail {
        let response: APIResponseWrapper<GroupDetail> = try await get(path: "/groups/\(groupID)")
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func addGroupMembers(groupID: Int, memberIDs: [String]) async throws {
        let body: [String: Any] = ["user_ids": memberIDs]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/members/add",
            body: body
        )
    }

    // MARK: - Push

    func registerDeviceToken(_ token: String) async throws {
        let body = ["device_token": token]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/push/device-token", body: body)
    }

    // MARK: - Image Loading

    func loadImage(path: String) async throws -> Data {
        let urlString: String
        if path.hasPrefix("http") {
            urlString = path
        } else if path.hasPrefix("/") {
            urlString = baseURL.replacingOccurrences(of: "/api/v1", with: "") + path
        } else {
            urlString = baseURL + "/" + path
        }

        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        if let token = AuthManager.shared.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        return data
    }

    // MARK: - Private Helpers

    private func get<T: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> T {
        guard var components = URLComponents(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        addAuthHeader(&request)

        return try await perform(request)
    }

    private func postJSON<T: Decodable>(
        path: String,
        body: [String: Any],
        auth: Bool = true
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        if auth {
            addAuthHeader(&request)
        }

        return try await perform(request)
    }

    private func uploadImage<T: Decodable>(
        path: String,
        fieldName: String?,
        fieldValue: String?,
        imageData: Data,
        filename: String
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        addAuthHeader(&request)

        var body = Data()
        // Optional extra field (e.g. receiver_id for DM images)
        if let fieldName = fieldName, let fieldValue = fieldValue {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(fieldName)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(fieldValue)\r\n".data(using: .utf8)!)
        }
        // image field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"image\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        return try await perform(request)
    }

    private func uploadVideo<T: Decodable>(
        path: String,
        fieldName: String?,
        fieldValue: String?,
        videoData: Data,
        filename: String
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 600
        addAuthHeader(&request)

        var body = Data()
        if let fieldName = fieldName, let fieldValue = fieldValue {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(fieldName)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(fieldValue)\r\n".data(using: .utf8)!)
        }
        let ext = (filename as NSString).pathExtension.lowercased()
        let mimeType: String
        switch ext {
        case "mov": mimeType = "video/quicktime"
        case "m4v": mimeType = "video/x-m4v"
        default: mimeType = "video/mp4"
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"video\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(videoData)
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        return try await perform(request)
    }

    private func addAuthHeader(_ request: inout URLRequest) {
        if let token = AuthManager.shared.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
}
