// BWChat/Utils/UIKitNav.swift
// UIKit-backed tab bar + per-tab navigation.
//
// Why not SwiftUI NavigationStack + TabView?
// SwiftUI's `.toolbar(.hidden, for: .tabBar)` removes the hidden state only
// AFTER the pop transition completes, producing a visible snap-in of the tab
// bar on swipe-back. UIKit's native UINavigationController +
// `hidesBottomBarWhenPushed` has animated the tab bar in perfect sync with
// push/pop since iOS 3 — so we defer to it entirely. Do NOT install a
// UINavigationControllerDelegate to "help" with the tab bar transform;
// a previous attempt (TabBarSyncDelegate) caused UIKit's own animation to
// fight our transform, leaving the bar at a wrong position on the first
// interactive pop and breaking the first-push for some root VCs.

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

// MARK: - Tab bar alpha normalisation
//
// iOS 18 UITabBarController bug, confirmed by logging:
//   push complete:  isHidden=true  alpha=1.0    <- alpha stays at 1
//   next pop start: UIKit flips isHidden=false, alpha still 1
//                   → tab bar appears FULLY VISIBLE immediately, no reveal
//
// The cancel path of an interactive pop, by contrast, ends with
// alpha=0 — which is why the SECOND swipe-back looks correct (alpha
// animates 0→1 during the transition).
//
// Fix: after every push completes, normalise tab bar alpha to 0. UIKit
// still treats it as hidden (isHidden=true), but the next pop's
// alongsideTransition will now animate alpha 0→1 naturally, matching
// the post-cancel behaviour on every subsequent swipe.

final class TabBarAlphaFixDelegate: NSObject, UINavigationControllerDelegate {
    func navigationController(
        _ nc: UINavigationController,
        didShow vc: UIViewController,
        animated: Bool
    ) {
        // Only relevant when we just settled on a pushed VC (stack > 1).
        // Root's tab bar stays at alpha=1 as usual.
        guard nc.viewControllers.count > 1 else { return }
        nc.tabBarController?.tabBar.alpha = 0
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

        // Force a classic opaque tab bar appearance.
        // iOS 18 defaults to a minimizable/floating pill bar whose transition
        // animation on interactive pop occasionally snaps to fully-visible on
        // the first swipe (users see "two layers" before it settles). Opaque
        // + explicit appearance is the only reliably-in-sync variant.
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        tb.tabBar.standardAppearance = appearance
        tb.tabBar.scrollEdgeAppearance = appearance

        tb.viewControllers = [
            Self.makeTab(
                root: ContactListView(),
                title: "消息",
                image: "bubble.left.and.bubble.right",
                selected: "bubble.left.and.bubble.right.fill",
                navDelegate: context.coordinator.tabBarAlphaFix
            ),
            Self.makeTab(
                root: ContactsTabView(),
                title: "通讯录",
                image: "person.crop.circle",
                selected: "person.crop.circle.fill",
                navDelegate: context.coordinator.tabBarAlphaFix
            ),
            Self.makeTab(
                root: DiscoverView(),
                title: "发现",
                image: "safari",
                selected: "safari.fill",
                navDelegate: context.coordinator.tabBarAlphaFix
            ),
            Self.makeTab(
                root: ProfileView(),
                title: "我",
                image: "gearshape",
                selected: "gearshape.fill",
                navDelegate: context.coordinator.tabBarAlphaFix
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
        navDelegate: UINavigationControllerDelegate
    ) -> UIViewController {
        let navigator = UIKitNavigator()
        let nav = UINavigationController()
        nav.navigationBar.prefersLargeTitles = true
        nav.delegate = navDelegate
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
        let tabBarAlphaFix = TabBarAlphaFixDelegate()

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
