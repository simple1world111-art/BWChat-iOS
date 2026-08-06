import SwiftUI

enum ScriptText {
    static func value(_ simplifiedChinese: String, _ english: String) -> String {
        switch AppLanguageStore.shared.activeLanguage {
        case .simplifiedChinese, .traditionalChinese, .system:
            return simplifiedChinese
        default:
            return english
        }
    }

    static func visibility(_ value: ScriptVisibility) -> String {
        switch value {
        case .private: return self.value("私人", "Private")
        case .public: return self.value("公开", "Public")
        }
    }

    static func status(_ value: ScriptStatus) -> String {
        switch value {
        case .draft: return self.value("草稿", "Draft")
        case .ready: return self.value("可开局", "Ready")
        case .archived: return self.value("已归档", "Archived")
        }
    }

    static func gender(_ value: String) -> String {
        switch value.lowercased() {
        case "male": return self.value("男", "Male")
        case "female": return self.value("女", "Female")
        case "non_binary", "nonbinary": return self.value("非二元", "Non-binary")
        default: return self.value("未设定", "Unspecified")
        }
    }
}

struct ScriptRemoteImage: View {
    let urlString: String
    let cornerRadius: CGFloat
    let fallbackSystemImage: String

    @State private var image: UIImage?
    @State private var didFail: Bool

    init(
        urlString: String,
        cornerRadius: CGFloat = 12,
        fallbackSystemImage: String = "book.closed.fill"
    ) {
        self.urlString = urlString
        self.cornerRadius = cornerRadius
        self.fallbackSystemImage = fallbackSystemImage
        let cacheKey = MediaURLResolver.resolve(urlString)?.absoluteString
        _image = State(initialValue: cacheKey.flatMap { ImageCacheManager.shared.image(for: $0) })
        _didFail = State(initialValue: false)
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if Self.shouldShowFallback(urlString: urlString, didFail: didFail) {
                fallback
            } else {
                loadingPlaceholder
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .task(id: urlString) { await load() }
    }

    static func shouldShowFallback(
        urlString: String?,
        didFail: Bool,
        apiBaseURL: String = AppConfig.apiBaseURL
    ) -> Bool {
        didFail || MediaURLResolver.resolve(urlString, apiBaseURL: apiBaseURL) == nil
    }

    private var loadingPlaceholder: some View {
        AppColors.accentLight
            .overlay(ProgressView().tint(AppColors.accent))
    }

    private var fallback: some View {
        ZStack {
            LinearGradient(
                colors: [AppColors.accentLight, Color(hex: "F2E8FF")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Image(systemName: fallbackSystemImage)
                .font(.system(size: 24, weight: .semibold))
                .foregroundColor(AppColors.accent.opacity(0.7))
        }
    }

    private func load() async {
        guard let url = MediaURLResolver.resolve(urlString) else {
            setStateWithoutAnimation(image: nil, didFail: false)
            return
        }
        let cacheKey = url.absoluteString
        if let cached = ImageCacheManager.shared.image(for: cacheKey) {
            setStateWithoutAnimation(image: cached, didFail: false)
            return
        }

        setStateWithoutAnimation(image: nil, didFail: false)
        if let loaded = await ImageCacheManager.shared.loadImage(from: cacheKey) {
            guard MediaURLResolver.resolve(urlString)?.absoluteString == cacheKey else { return }
            setStateWithoutAnimation(image: loaded, didFail: false)
        } else {
            guard MediaURLResolver.resolve(urlString)?.absoluteString == cacheKey else { return }
            setStateWithoutAnimation(image: nil, didFail: true)
        }
    }

    private func setStateWithoutAnimation(image: UIImage?, didFail: Bool) {
        var transaction = Transaction()
        transaction.animation = nil
        withTransaction(transaction) {
            self.image = image
            self.didFail = didFail
        }
    }
}

struct ScriptCenterView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = ScriptCenterViewModel()

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        VStack(spacing: 0) {
            categoryPicker
            content
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.clear, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .principal) {
                SystemSegmentedTabs(
                    items: ScriptScope.allCases,
                    selection: scopeSelection,
                    title: scopeTitle,
                    accessibilityIdentifier: "script.center.top.tabs"
                )
                .frame(width: 196)
                .accessibilityElement(children: .contain)
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    navigator.push(ScriptEditorView(script: nil))
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(ScriptText.value("创建剧本", "Create script"))
            }
        }
        .task { await viewModel.loadInitial() }
        .onReceive(NotificationCenter.default.publisher(for: .scriptLibraryDidChange)) { _ in
            Task { await viewModel.handleLibraryChange() }
        }
    }

    private var scopeSelection: Binding<ScriptScope> {
        Binding(
            get: { viewModel.scope },
            set: { scope in
                Task { await viewModel.selectScope(scope) }
            }
        )
    }

    private func scopeTitle(_ scope: ScriptScope) -> String {
        switch scope {
        case .public:
            return ScriptText.value("公开剧本", "Public")
        case .mine:
            return ScriptText.value("我的剧本", "Mine")
        }
    }

    private var categoryPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                categoryButton(id: nil, title: ScriptText.value("全部", "All"))
                ForEach(viewModel.categories) { category in
                    categoryButton(id: category.id, title: category.name)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 12)
        }
    }

    private func categoryButton(id: String?, title: String) -> some View {
        let selected = viewModel.selectedCategoryID == id
        return Button {
            Task { await viewModel.selectCategory(id) }
        } label: {
            Text(title)
                .font(.system(size: 13, weight: selected ? .semibold : .regular))
                .foregroundColor(selected ? AppColors.accent : AppColors.secondaryText)
                .padding(.horizontal, 13)
                .padding(.vertical, 7)
                .background(selected ? AppColors.accentLight : AppColors.cardBackground)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.scripts.isEmpty {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(0..<6, id: \.self) { _ in
                        ScriptCard(script: .placeholder)
                    }
                }
                .redacted(reason: .placeholder)
                .allowsHitTesting(false)
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
        } else if viewModel.scripts.isEmpty, let error = viewModel.errorMessage {
            VStack(spacing: 14) {
                ScriptEmptyState(
                    icon: "exclamationmark.triangle",
                    title: ScriptText.value("无法加载公开剧本", "Unable to load scripts"),
                    subtitle: error
                )
                Button(ScriptText.value("重试", "Retry")) {
                    Task { await viewModel.refresh() }
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.accent)
                .padding(.bottom, 28)
            }
        } else if viewModel.scripts.isEmpty {
            ScriptEmptyState(
                icon: viewModel.scope == .mine ? "square.and.pencil" : "book.closed",
                title: viewModel.scope == .mine
                    ? ScriptText.value("还没有创建剧本", "No scripts yet")
                    : ScriptText.value("暂无公开剧本", "No public scripts"),
                subtitle: viewModel.scope == .mine
                    ? ScriptText.value("创建角色和世界设定，开始你的故事", "Create roles and a world to begin")
                    : ScriptText.value("稍后再来看看新的故事", "Check back for new stories")
            )
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(viewModel.scripts) { script in
                        Button {
                            navigator.push(ScriptDetailView(scriptID: script.id, initialScript: script))
                        } label: {
                            ScriptCard(script: script)
                        }
                        .buttonStyle(.plain)
                        .onAppear { viewModel.loadMoreIfNeeded(currentScriptID: script.id) }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)

                if viewModel.isLoadingMore {
                    ProgressView().padding(.bottom, 20)
                }
            }
            .refreshable { await viewModel.refresh() }
        }
    }
}

struct ScriptEmptyState: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: icon)
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(AppColors.accentGradient)
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
            Text(subtitle)
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ScriptCard: View {
    let script: InteractiveScript

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ZStack(alignment: .topTrailing) {
                ScriptRemoteImage(urlString: script.coverURL, cornerRadius: 12)
                    .frame(maxWidth: .infinity)
                    .aspectRatio(0.82, contentMode: .fit)
                    .clipped()

                if script.visibility == .private || script.status != .ready || script.isAdminHidden {
                    Text(badgeText)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(Color.black.opacity(0.62))
                        .clipShape(Capsule())
                        .padding(7)
                }
            }

            Text(script.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
                .lineLimit(1)

            Text(script.synopsis)
                .font(.system(size: 12))
                .foregroundColor(AppColors.secondaryText)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .topLeading)

            HStack(spacing: -5) {
                ForEach(Array(script.roles.prefix(4))) { role in
                    ScriptRemoteImage(
                        urlString: role.avatarURL,
                        cornerRadius: 11,
                        fallbackSystemImage: "person.fill"
                    )
                        .frame(width: 22, height: 22)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(AppColors.cardBackground, lineWidth: 1.5))
                }
                Spacer(minLength: 4)
                Text(script.creator.nickname)
                    .font(.system(size: 10))
                    .foregroundColor(AppColors.tertiaryText)
                    .lineLimit(1)
            }
        }
        .padding(10)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
    }

    private var badgeText: String {
        if script.isAdminHidden { return ScriptText.value("已隐藏", "Hidden") }
        if script.status != .ready { return ScriptText.status(script.status) }
        return ScriptText.visibility(script.visibility)
    }
}

private extension InteractiveScript {
    static let placeholder = InteractiveScript(
        scriptID: UUID().uuidString,
        title: "Placeholder",
        synopsis: "Placeholder synopsis for loading state.",
        coverURL: "",
        categoryIDs: [],
        visibility: .public,
        status: .ready,
        creator: ScriptCreator(nickname: "Creator"),
        roles: []
    )
}
