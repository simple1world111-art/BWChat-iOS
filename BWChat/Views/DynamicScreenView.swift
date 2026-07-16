import SwiftUI

struct DynamicScreenView: View {
    let screenID: String

    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var languageStore = AppLanguageStore.shared
    @StateObject private var screenStore: DynamicScreenStore
    @State private var routeAlert: DynamicRouteAlert?

    init(screenID: String) {
        self.screenID = screenID
        self._screenStore = StateObject(wrappedValue: DynamicScreenStore(screenID: screenID))
    }

    var body: some View {
        Group {
            if let screen = screenStore.screen {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(screen.components.filter(\.isVisible)) { component in
                            DynamicComponentRenderer(component: component, onRoute: openRoute)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 24)
                }
            } else if screenStore.isLoading {
                ProgressView()
                    .tint(AppColors.accent)
            } else {
                emptyState
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(screenStore.screen?.displayTitle(language: languageStore.activeLanguage) ?? screenID)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task {
            await screenStore.load()
        }
        .refreshable {
            await screenStore.load(force: true)
        }
        .alert(item: $routeAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text(L10n.tr("common.ok")))
            )
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 38, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
            Text(screenStore.errorMessage ?? L10n.tr("discover.comingSoon"))
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func openRoute(_ route: DynamicRoute?) {
        switch DynamicRouteHandler.open(route, navigator: navigator, fallbackTitle: screenStore.screen?.displayTitle() ?? screenID) {
        case .handled:
            break
        case .alert(let alert):
            routeAlert = alert
        }
    }
}

struct DynamicComponentRenderer: View {
    let component: DynamicComponent
    let onRoute: (DynamicRoute?) -> Void

    @ObservedObject private var languageStore = AppLanguageStore.shared
    @ObservedObject private var walletStore = WalletStore.shared

    var body: some View {
        switch component.type.normalizedDynamicToken {
        case "screen", "section", "list":
            childStack
        case "card":
            card { childStack }
        case "row", "actionrow", "action_row":
            row
        case "banner":
            banner
        case "text":
            textBlock
        case "image":
            imageBlock
        case "button":
            button
        case "divider":
            Divider().background(AppColors.separator)
        case "spacer":
            Spacer(minLength: CGFloat(component.props.int("height") ?? 8))
        case "walletbalance", "wallet_balance":
            walletBalance
        case "giftpreview", "gift_preview":
            giftPreview
        case "agentlist", "agent_list":
            agentList
        default:
            EmptyView()
        }
    }

    private var childStack: some View {
        VStack(spacing: 10) {
            ForEach((component.children ?? []).filter(\.isVisible)) { child in
                DynamicComponentRenderer(component: child, onRoute: onRoute)
            }
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }

    private var row: some View {
        Button {
            onRoute(component.action)
        } label: {
            HStack(spacing: 12) {
                iconView(size: 40)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var banner: some View {
        Button {
            if component.action != nil {
                onRoute(component.action)
            }
        } label: {
            HStack(spacing: 14) {
                iconView(size: 48)
                VStack(alignment: .leading, spacing: 5) {
                    Text(title)
                        .font(.system(size: 19, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(2)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(3)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [Color(hex: "FFF4C9"), Color(hex: "E9F8FF")],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .cornerRadius(14)
        }
        .buttonStyle(.plain)
        .disabled(component.action == nil)
    }

    private var textBlock: some View {
        let style = component.props.string("style")?.normalizedDynamicToken
        return Text(title)
            .font(.system(size: style == "title" ? 22 : 15, weight: style == "title" ? .bold : .regular))
            .foregroundColor(style == "title" ? AppColors.primaryText : AppColors.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var imageBlock: some View {
        RemoteAssetImage(
            assetKey: component.props.string("asset_key") ?? component.props.string("remote_asset_key"),
            fallbackAssetName: component.props.string("fallback_asset_name"),
            fallbackSystemImage: component.props.string("system_image") ?? "photo"
        )
        .frame(maxWidth: .infinity)
        .frame(height: CGFloat(component.props.int("height") ?? 160))
        .background(AppColors.cardBackground)
        .cornerRadius(14)
        .clipped()
    }

    private var button: some View {
        Button {
            onRoute(component.action)
        } label: {
            HStack(spacing: 8) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .bold))
                }
                Text(title)
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .background(AppColors.accentGradient)
            .cornerRadius(14)
        }
        .buttonStyle(.plain)
    }

    private var walletBalance: some View {
        card {
            Button {
                onRoute(component.action ?? DynamicRoute(type: "native", name: "wallet"))
            } label: {
                HStack(spacing: 12) {
                    iconView(size: 42, fallback: "pawprint.fill")
                    VStack(alignment: .leading, spacing: 3) {
                        Text(L10n.tr("wallet.balance"))
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.secondaryText)
                        Text(walletStore.balance.map(String.init) ?? L10n.tr("common.loading"))
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(AppColors.primaryText)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.tertiaryText)
                }
                .padding(16)
            }
            .buttonStyle(.plain)
        }
        .task {
            await walletStore.refreshBalanceFromServer()
        }
    }

    private var giftPreview: some View {
        card {
            HStack(spacing: 12) {
                ForEach(GiftCatalogItem.fixedCatalog.prefix(4)) { gift in
                    VStack(spacing: 5) {
                        GiftAssetIcon(assetKey: gift.assetKey, size: 42)
                        Text(gift.localizedName)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(14)
        }
    }

    private var agentList: some View {
        card {
            Button {
                onRoute(component.action ?? DynamicRoute(type: "native", name: "agent_hub"))
            } label: {
                HStack(spacing: 12) {
                    AgentAvatarView(assetID: nil, size: 42)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Agent Platform")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(AppColors.primaryText)
                        Text("查看、调整并与我创建的智能体聊天")
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.tertiaryText)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
            }
            .buttonStyle(.plain)
        }
    }

    private func iconView(size: CGFloat, fallback: String? = nil) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(iconFill)
                .frame(width: size, height: size)

            if let remoteIconKey = component.props.string("remote_icon_key") {
                RemoteAssetImage(assetKey: remoteIconKey, fallbackSystemImage: systemImage ?? fallback ?? "sparkles")
                    .padding(size * 0.22)
            } else {
                Image(systemName: systemImage ?? fallback ?? "sparkles")
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundColor(.white)
            }
        }
    }

    private var iconFill: AnyShapeStyle {
        let colors = component.props.array("colors")?
            .compactMap(\.stringValue)
            .filter(\.isDynamicHexColor)
            .prefix(2)
            .map(Color.init(hex:)) ?? []
        if colors.count >= 2 {
            return AnyShapeStyle(LinearGradient(colors: Array(colors), startPoint: .topLeading, endPoint: .bottomTrailing))
        }
        return AnyShapeStyle(colors.first ?? AppColors.accent)
    }

    private var title: String {
        component.props.localizedString("title", language: languageStore.activeLanguage)
            ?? component.props.localizedString("text", language: languageStore.activeLanguage)
            ?? component.id
    }

    private var subtitle: String? {
        component.props.localizedString("subtitle", language: languageStore.activeLanguage)
    }

    private var systemImage: String? {
        component.props.string("system_image")
    }
}

private extension Dictionary where Key == String, Value == JSONValue {
    func array(_ key: String) -> [JSONValue]? {
        self[key]?.arrayValue
    }

    func localizedString(_ key: String, language: AppLanguage) -> String? {
        guard let value = self[key] else { return nil }
        switch value {
        case .string(let string):
            return string.isDynamicBlank ? nil : string
        case .object(let object):
            let dictionary = object.compactMapValues(\.stringValue)
            return dictionary.localizedDynamicValue(for: language)
        default:
            return value.stringValue
        }
    }
}
