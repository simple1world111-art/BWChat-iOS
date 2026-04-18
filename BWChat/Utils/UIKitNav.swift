// BWChat/Utils/UIKitNav.swift
// UIKit-backed tab bar + per-tab navigation.
//
// Why not SwiftUI NavigationStack + TabView?
// SwiftUI's `.toolbar(.hidden, for: .tabBar)` removes the hidden state only
// AFTER the pop transition completes, producing a visible snap-in of the tab
// bar on swipe-back. Various hacks (transforms, swizzles, CADisplayLink
// forcing isHidden=false) all lost to SwiftUI's internal tab-bar state
// machine. UIKit's native UINavigationController + `hidesBottomBarWhenPushed`
// has animated the tab bar in perfect sync with push/pop since iOS 3 — so
// we defer to it.
//
// On top of `hidesBottomBarWhenPushed`, we register a
// `UINavigationControllerDelegate` that re-pins the tab bar's transform to
// `transitionCoordinator.animate(alongsideTransition:)`. During interactive
// swipe-back, UIKit's built-in animation can occasionally "snap" the bar to
// fully visible instead of tracking the gesture percentage; piggy-backing on
// the coordinator guarantees the tab bar's transform is interpolated frame-
// by-frame in sync with the pop gesture.

import SwiftUI
import UIKit

// MARK: - Navigator

/// Exposed to SwiftUI views via @EnvironmentObject. Pushes wrap the target
/// view in a UIHostingController with `hidesBottomBarWhenPushed = true`, so
/// the parent UITabBar animates off the bottom in sync with the push and
/// slides back in on pop.
@MainActor
final class UIKitNavigator: ObservableObject {
    weak var navigationController: UINavigationController?

    func push<V: View>(_ view: V) {
        let host = UIHostingController(rootView: view.environmentObject(self))
        host.hidesBottomBarWhenPushed = true
        navigationController?.pushViewController(host, animated: true)
    }

    func pop() {
        navigationController?.popViewController(animated: true)
    }

    func popToRoot() {
        navigationController?.popToRootViewController(animated: true)
    }
}

// MARK: - Tab Bar sync delegate

/// Drives the tab bar's transform off `transitionCoordinator.animate(...)`,
/// which UIKit interpolates in step with the interactive pop gesture. This
/// replaces UIKit's default tab bar animation (which can snap to fully
/// visible mid-gesture) with a transform that strictly tracks the swipe.
final class TabBarSyncDelegate: NSObject, UINavigationControllerDelegate {
    func navigationController(
        _ navigationController: UINavigationController,
        willShow viewController: UIViewController,
        animated: Bool
    ) {
        guard let tabBar = navigationController.tabBarController?.tabBar else { return }
        let isRoot = viewController === navigationController.viewControllers.first
        // bounds.height already includes the home-indicator safe-area slot.
        let hidden = CGAffineTransform(translationX: 0, y: tabBar.bounds.height)
        let target: CGAffineTransform = isRoot ? .identity : hidden

        guard animated, let coord = navigationController.transitionCoordinator else {
            tabBar.transform = target
            return
        }

        coord.animate(
            alongsideTransition: { _ in
                tabBar.transform = target
            },
            completion: { ctx in
                if ctx.isCancelled {
                    // Interactive pop released before threshold — restore prior state.
                    tabBar.transform = isRoot ? hidden : .identity
                }
            }
        )
    }
}

// MARK: - Tab Bar Controller

struct MainTabController: UIViewControllerRepresentable {
    @Binding var selectedIndex: Int

    func makeCoordinator() -> Coordinator {
        Coordinator(selectedIndex: $selectedIndex)
    }

    func makeUIViewController(context: Context) -> UITabBarController {
        let tb = UITabBarController()
        tb.delegate = context.coordinator
        tb.tabBar.tintColor = UIColor(AppColors.accent)

        tb.viewControllers = [
            Self.makeTab(
                root: ContactListView(),
                title: "消息",
                image: "bubble.left.and.bubble.right",
                selected: "bubble.left.and.bubble.right.fill",
                syncDelegate: context.coordinator.tabBarSync
            ),
            Self.makeTab(
                root: ContactsTabView(),
                title: "通讯录",
                image: "person.crop.circle",
                selected: "person.crop.circle.fill",
                syncDelegate: context.coordinator.tabBarSync
            ),
            Self.makeTab(
                root: DiscoverView(),
                title: "发现",
                image: "safari",
                selected: "safari.fill",
                syncDelegate: context.coordinator.tabBarSync
            ),
            Self.makeTab(
                root: ProfileView(),
                title: "我",
                image: "gearshape",
                selected: "gearshape.fill",
                syncDelegate: context.coordinator.tabBarSync
            ),
        ]
        tb.selectedIndex = selectedIndex
        return tb
    }

    func updateUIViewController(_ tb: UITabBarController, context: Context) {
        if tb.selectedIndex != selectedIndex {
            tb.selectedIndex = selectedIndex
        }
    }

    private static func makeTab<V: View>(
        root: V,
        title: String,
        image: String,
        selected: String,
        syncDelegate: TabBarSyncDelegate
    ) -> UIViewController {
        let navigator = UIKitNavigator()
        let nav = UINavigationController()
        nav.navigationBar.prefersLargeTitles = true
        // UINavigationController.delegate is weak — the Coordinator owns the
        // TabBarSyncDelegate, so it outlives the nav controller.
        nav.delegate = syncDelegate
        navigator.navigationController = nav

        let host = UIHostingController(rootView: AnyView(root.environmentObject(navigator)))
        nav.viewControllers = [host]
        nav.tabBarItem = UITabBarItem(
            title: title,
            image: UIImage(systemName: image),
            selectedImage: UIImage(systemName: selected)
        )
        return nav
    }

    final class Coordinator: NSObject, UITabBarControllerDelegate {
        var selectedIndex: Binding<Int>
        let tabBarSync = TabBarSyncDelegate()

        init(selectedIndex: Binding<Int>) {
            self.selectedIndex = selectedIndex
        }

        func tabBarController(
            _ tabBarController: UITabBarController,
            didSelect viewController: UIViewController
        ) {
            if let idx = tabBarController.viewControllers?.firstIndex(of: viewController),
               selectedIndex.wrappedValue != idx {
                selectedIndex.wrappedValue = idx
            }
        }
    }
}
