import Foundation
import SwiftUI
import UIKit

extension Notification.Name {
    static let openMainTab = Notification.Name("bbchat.openMainTab")
}

struct DynamicRouteAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

enum DynamicRouteOutcome {
    case handled
    case alert(DynamicRouteAlert)
}

@MainActor
enum DynamicRouteHandler {
    static let nativeWhitelist: Set<String> = [
        "messages",
        "contacts",
        "map",
        "discover",
        "profile",
        "moments",
        "my_moments",
        "groups",
        "my_groups",
        "nearby",
        "wallet",
        "prop_bag",
        "activity_center",
        "settings",
        "edit_profile",
        "friend_requests",
        "add_friend",
        "create_group",
        "agent_create",
        "agent_hub",
        "games",
        "game_center",
        "short_drama",
        "my_short_dramas",
        "script_center"
    ]

    static func open(
        _ route: DynamicRoute?,
        navigator: UIKitNavigator,
        fallbackTitle: String = L10n.tr("common.operationFailed")
    ) -> DynamicRouteOutcome {
        guard let route else {
            return comingSoon(title: fallbackTitle, message: nil)
        }

        switch route.normalizedType {
        case "native":
            return openNative(route, navigator: navigator, fallbackTitle: fallbackTitle)
        case "web", "h5", "url":
            return openWeb(route, navigator: navigator, fallbackTitle: fallbackTitle)
        case "screen":
            let screenID = route.screenID ?? route.name
            guard let screenID, !screenID.isDynamicBlank else {
                return comingSoon(title: fallbackTitle, message: route.displayMessage())
            }
            navigator.push(DynamicScreenView(screenID: screenID))
            return .handled
        case "external":
            return openExternal(route, fallbackTitle: fallbackTitle)
        case "disabled", "coming_soon", "comingsoon":
            return comingSoon(
                title: route.displayTitle(fallback: fallbackTitle),
                message: route.displayMessage()
            )
        default:
            return comingSoon(
                title: route.displayTitle(fallback: fallbackTitle),
                message: route.displayMessage()
            )
        }
    }

    private static func openNative(
        _ route: DynamicRoute,
        navigator: UIKitNavigator,
        fallbackTitle: String
    ) -> DynamicRouteOutcome {
        let name = route.normalizedName
        guard nativeWhitelist.contains(name) else {
            return comingSoon(
                title: route.displayTitle(fallback: fallbackTitle),
                message: route.displayMessage()
            )
        }

        switch name {
        case "messages", "map", "discover", "profile":
            NotificationCenter.default.post(
                name: .openMainTab,
                object: nil,
                userInfo: ["tabID": name]
            )
            navigator.popToRoot()
        case "contacts":
            navigator.push(ContactsTabView(isRootTab: false))
        case "moments":
            MomentsNotificationManager.shared.markFeedViewed()
            navigator.push(MomentsView())
        case "my_moments":
            navigator.push(MomentsView(
                filterUserID: AuthManager.shared.currentUser?.userID,
                pageTitleKey: "profile.moments"
            ))
        case "groups":
            navigator.push(GroupListView().withUIKitBackButton())
        case "my_groups":
            navigator.push(GroupListView(mode: .myGroups).withUIKitBackButton())
        case "nearby":
            navigator.push(MapDatingView())
        case "wallet":
            navigator.push(WalletView())
        case "prop_bag":
            navigator.push(PropBagView())
        case "activity_center":
            navigator.push(ActivityCenterView())
        case "settings":
            navigator.push(ProfileSettingsView(viewModel: ProfileViewModel()))
        case "edit_profile":
            navigator.push(EditProfileView(viewModel: ProfileViewModel()))
        case "friend_requests":
            navigator.push(FriendRequestsView())
        case "add_friend":
            navigator.push(AddFriendView())
        case "create_group":
            navigator.push(CreateGroupView())
        case "agent_create":
            navigator.push(AgentCreatorView(mode: .create))
        case "agent_hub":
            navigator.push(AgentHubView())
        case "games", "game_center":
            navigator.push(GameCenterView())
        case "short_drama":
            navigator.push(ShortDramaSeriesListView())
        case "my_short_dramas":
            navigator.push(ShortDramaStudioView())
        case "script_center":
            navigator.push(ScriptCenterView())
        default:
            return comingSoon(
                title: route.displayTitle(fallback: fallbackTitle),
                message: route.displayMessage()
            )
        }

        return .handled
    }

    private static func openWeb(
        _ route: DynamicRoute,
        navigator: UIKitNavigator,
        fallbackTitle: String
    ) -> DynamicRouteOutcome {
        guard let urlString = route.url,
              let url = URL(string: urlString),
              AppRemoteConfigStore.shared.config.webViewPolicy.allows(url) else {
            return DynamicRouteOutcome.alert(DynamicRouteAlert(
                title: route.displayTitle(fallback: fallbackTitle),
                message: route.displayMessage() ?? L10n.tr("common.operationFailed")
            ))
        }

        navigator.push(InAppWebView(
            url: url,
            title: route.displayTitle(fallback: fallbackTitle)
        ))
        return .handled
    }

    private static func openExternal(
        _ route: DynamicRoute,
        fallbackTitle: String
    ) -> DynamicRouteOutcome {
        guard route.params?.bool("allow_external") == true,
              let urlString = route.url,
              let url = URL(string: urlString) else {
            return comingSoon(title: route.displayTitle(fallback: fallbackTitle), message: route.displayMessage())
        }
        UIApplication.shared.open(url)
        return .handled
    }

    private static func comingSoon(title: String, message: String?) -> DynamicRouteOutcome {
        .alert(DynamicRouteAlert(
            title: title,
            message: message ?? L10n.tr("discover.comingSoon")
        ))
    }
}
