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
        NavDebug.snapshot(tag: "push BEFORE \(V.self)", nav: navigationController)
        navigationController?.pushViewController(host, animated: true)
        NavDebug.snapshot(tag: "push AFTER \(V.self)", nav: navigationController)
    }

    func pop() {
        navigationController?.popViewController(animated: true)
    }

    func popToRoot() {
        navigationController?.popToRootViewController(animated: true)
    }
}

// MARK: - Debug logging (remove after diagnosing first-swipe tab bar glitch)

enum NavDebug {
    static func snapshot(tag: String, nav: UINavigationController?) {
        let tb = nav?.tabBarController?.tabBar
        let stack = nav?.viewControllers.count ?? -1
        let frame = tb?.frame ?? .zero
        let t = tb?.transform ?? .identity
        let hidden = tb?.isHidden ?? false
        let alpha = tb?.alpha ?? -1
        print("[NavDebug] \(tag) | stack=\(stack) tbFrame=\(frame) transform=(\(t.tx),\(t.ty)) hidden=\(hidden) alpha=\(alpha)")
    }
}

final class NavLoggingDelegate: NSObject, UINavigationControllerDelegate {
    func navigationController(_ nc: UINavigationController, willShow vc: UIViewController, animated: Bool) {
        NavDebug.snapshot(tag: "willShow \(type(of: vc)) animated=\(animated)", nav: nc)

        guard let coord = nc.transitionCoordinator else { return }
        let fromVC = coord.viewController(forKey: .from)
        let toVC = coord.viewController(forKey: .to)
        print("[NavDebug]   coord: from=\(fromVC.map { String(describing: type(of: $0)) } ?? "nil") to=\(toVC.map { String(describing: type(of: $0)) } ?? "nil") duration=\(coord.transitionDuration) interactive=\(coord.isInteractive)")

        coord.notifyWhenInteractionChanges { ctx in
            NavDebug.snapshot(tag: "interaction changed isCancelled=\(ctx.isCancelled) complete=\(ctx.percentComplete)", nav: nc)
        }
        coord.animate(alongsideTransition: { _ in
            NavDebug.snapshot(tag: "alongsideTransition tick", nav: nc)
        }, completion: { ctx in
            NavDebug.snapshot(tag: "transition completed isCancelled=\(ctx.isCancelled)", nav: nc)
        })
    }

    func navigationController(_ nc: UINavigationController, didShow vc: UIViewController, animated: Bool) {
        NavDebug.snapshot(tag: "didShow \(type(of: vc))", nav: nc)
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
                navDelegate: context.coordinator.navLogger
            ),
            Self.makeTab(
                root: ContactsTabView(),
                title: "通讯录",
                image: "person.crop.circle",
                selected: "person.crop.circle.fill",
                navDelegate: context.coordinator.navLogger
            ),
            Self.makeTab(
                root: DiscoverView(),
                title: "发现",
                image: "safari",
                selected: "safari.fill",
                navDelegate: context.coordinator.navLogger
            ),
            Self.makeTab(
                root: ProfileView(),
                title: "我",
                image: "gearshape",
                selected: "gearshape.fill",
                navDelegate: context.coordinator.navLogger
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
        let navLogger = NavLoggingDelegate()

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
