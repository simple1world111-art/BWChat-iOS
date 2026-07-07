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

    var canPopPushedController: Bool {
        (navigationController?.viewControllers.count ?? 0) > 1
    }

    func push<V: View>(_ view: V) {
        guard let navigationController else { return }
        performWhenReady(on: navigationController) { [weak self, weak navigationController] in
            guard let self, let navigationController else { return }
            let host = NavigableHostingController(
                rootView: AnyView(view.environmentObject(self).appLocalizedEnvironment())
            )
            host.hidesBottomBarWhenPushed = true
            navigationController.pushViewController(host, animated: true)
            navigationController.repairNavigationSurface()
        }
    }

    func pop() {
        guard let navigationController else { return }
        performWhenReady(on: navigationController) { [weak navigationController] in
            guard let navigationController else { return }
            if navigationController.viewControllers.count > 1 {
                navigationController.popViewController(animated: true)
                navigationController.repairNavigationSurface()
            } else {
                navigationController.dismiss(animated: true)
            }
        }
    }

    func popToRoot() {
        guard let navigationController else { return }
        performWhenReady(on: navigationController) { [weak navigationController] in
            guard let navigationController else { return }
            navigationController.popToRootViewController(animated: true)
            navigationController.repairNavigationSurface()
        }
    }

    private func performWhenReady(
        on navigationController: UINavigationController,
        action: @escaping @MainActor () -> Void
    ) {
        if let coordinator = navigationController.transitionCoordinator {
            coordinator.animate(alongsideTransition: nil) { _ in
                DispatchQueue.main.async {
                    action()
                }
            }
        } else {
            action()
        }
    }
}

final class NavigableHostingController: UIHostingController<AnyView> {
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.interactivePopGestureRecognizer?.isEnabled =
            (navigationController?.viewControllers.count ?? 0) > 1
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        navigationController?.repairNavigationSurface()
    }
}

private extension UINavigationController {
    func repairNavigationSurface() {
        interactivePopGestureRecognizer?.isEnabled = viewControllers.count > 1

        guard let tabBar = tabBarController?.tabBar else { return }
        if viewControllers.count <= 1 {
            tabBar.isHidden = false
            tabBar.alpha = 1
            tabBar.isUserInteractionEnabled = true
            tabBar.transform = .identity
        } else {
            tabBar.isHidden = true
            tabBar.alpha = 0
            tabBar.isUserInteractionEnabled = false
            tabBar.transform = .identity
        }
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
    private func restoreInteractivePop(for nc: UINavigationController) {
        nc.interactivePopGestureRecognizer?.isEnabled = nc.viewControllers.count > 1
    }

    func normalizeTabBar(for nc: UINavigationController) {
        nc.repairNavigationSurface()
    }

    func navigationController(
        _ nc: UINavigationController,
        willShow vc: UIViewController,
        animated: Bool
    ) {
        restoreInteractivePop(for: nc)

        // Schedule the alpha normalisation to run AFTER UIKit's own transition
        // completion. Timing order (empirically verified on-device):
        //
        //   1. alongsideTransition block — alpha = 0 during animation
        //   2. `didShow(:animated:)`       — alpha still 0
        //   3. coord.animate completion    — alpha has been restored to 1 by UIKit
        //
        // Setting alpha=0 in didShow is too early — UIKit overwrites it back to
        // 1 after we run. Piggy-backing on transitionCoordinator.animate's
        // completion runs after that, so our alpha=0 sticks and the next
        // pop animates 0→1 naturally.
        let isShowingRoot = nc.viewControllers.first === vc
        guard let coord = nc.transitionCoordinator else {
            normalizeTabBar(for: nc)
            return
        }

        if isShowingRoot, let tabBar = nc.tabBarController?.tabBar {
            tabBar.isHidden = false
            coord.animate(alongsideTransition: { _ in
                tabBar.alpha = 1
            }, completion: { [weak self, weak nc] _ in
                guard let nc else { return }
                self?.restoreInteractivePop(for: nc)
                self?.normalizeTabBar(for: nc)
            })
            return
        }

        coord.animate(alongsideTransition: nil, completion: { [weak self, weak nc] _ in
            guard let nc else { return }
            self?.restoreInteractivePop(for: nc)
            self?.normalizeTabBar(for: nc)
        })
    }

    func navigationController(
        _ nc: UINavigationController,
        didShow viewController: UIViewController,
        animated: Bool
    ) {
        restoreInteractivePop(for: nc)
        normalizeTabBar(for: nc)
    }
}

final class InteractivePopDelegate: NSObject, UIGestureRecognizerDelegate {
    weak var navigationController: UINavigationController?

    init(navigationController: UINavigationController) {
        self.navigationController = navigationController
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let navigationController else { return false }
        return navigationController.viewControllers.count > 1
            && navigationController.transitionCoordinator == nil
    }
}

final class SwipeBackCoordinator: NSObject, UIGestureRecognizerDelegate {
    weak var navigationController: UINavigationController?
    private weak var panGesture: UIPanGestureRecognizer?

    init(navigationController: UINavigationController) {
        self.navigationController = navigationController
        super.init()

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.delegate = self
        pan.cancelsTouchesInView = false
        navigationController.view.addGestureRecognizer(pan)
        self.panGesture = pan
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        guard gesture.state == .ended,
              let navigationController,
              navigationController.viewControllers.count > 1,
              navigationController.transitionCoordinator == nil
        else { return }

        let translation = gesture.translation(in: gesture.view)
        let velocity = gesture.velocity(in: gesture.view)
        let shouldPop = translation.x > 72 || velocity.x > 650
        if shouldPop {
            navigationController.popViewController(animated: true)
            navigationController.repairNavigationSurface()
        }
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === panGesture,
              let pan = gestureRecognizer as? UIPanGestureRecognizer,
              let navigationController,
              navigationController.viewControllers.count > 1,
              navigationController.transitionCoordinator == nil,
              let view = pan.view
        else { return false }

        let location = pan.location(in: view)
        let velocity = pan.velocity(in: view)
        let startsInBackZone = location.x <= 96
        let movesRight = velocity.x > 180
        let mostlyHorizontal = abs(velocity.x) > abs(velocity.y) * 1.2
        return startsInBackZone && movesRight && mostlyHorizontal
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}

// MARK: - Tab Bar Controller

struct MainTabController: UIViewControllerRepresentable {
    @Binding var selectedIndex: Int
    let repairID: Int
    let languageIdentifier: String

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
                title: L10n.tr("tab.messages"),
                image: "bubble.left.and.bubble.right",
                selected: "bubble.left.and.bubble.right.fill",
                coordinator: context.coordinator
            ),
            Self.makeTab(
                root: ContactsTabView(),
                title: L10n.tr("tab.contacts"),
                image: "person.crop.circle",
                selected: "person.crop.circle.fill",
                coordinator: context.coordinator
            ),
            Self.makeTab(
                root: MapDatingView(isRootTab: true),
                title: L10n.tr("tab.map"),
                image: "map",
                selected: "map.fill",
                coordinator: context.coordinator
            ),
            Self.makeTab(
                root: DiscoverView(),
                title: L10n.tr("tab.discover"),
                image: "safari",
                selected: "safari.fill",
                coordinator: context.coordinator
            ),
            Self.makeTab(
                root: ProfileView(),
                title: L10n.tr("tab.profile"),
                image: "gearshape",
                selected: "gearshape.fill",
                coordinator: context.coordinator
            ),
        ]
        tb.selectedIndex = selectedIndex
        return tb
    }

    func updateUIViewController(_ tb: UITabBarController, context: Context) {
        if tb.selectedIndex != selectedIndex {
            tb.selectedIndex = selectedIndex
        }
        _ = repairID
        _ = languageIdentifier
        Self.applyTabTitles(to: tb)
        context.coordinator.repairRootTabBarIfNeeded(in: tb)
    }

    private static func makeTab<V: View>(
        root: V,
        title: String,
        image: String,
        selected: String,
        coordinator: Coordinator
    ) -> UIViewController {
        let navigator = UIKitNavigator()
        let nav = UINavigationController()
        nav.navigationBar.prefersLargeTitles = false
        nav.delegate = coordinator.tabBarAlphaFix
        navigator.navigationController = nav

        let interactivePopDelegate = InteractivePopDelegate(navigationController: nav)
        nav.interactivePopGestureRecognizer?.delegate = interactivePopDelegate
        nav.interactivePopGestureRecognizer?.isEnabled = false
        let swipeBackCoordinator = SwipeBackCoordinator(navigationController: nav)
        coordinator.retain(interactivePopDelegate)
        coordinator.retain(swipeBackCoordinator)
        coordinator.retain(navigator)

        let host = NavigableHostingController(
            rootView: AnyView(root.environmentObject(navigator).appLocalizedEnvironment())
        )
        nav.viewControllers = [host]
        nav.tabBarItem = UITabBarItem(
            title: title,
            image: UIImage(systemName: image),
            selectedImage: UIImage(systemName: selected)
        )
        return nav
    }

    private static func applyTabTitles(to tabBarController: UITabBarController) {
        let titles = [
            L10n.tr("tab.messages"),
            L10n.tr("tab.contacts"),
            L10n.tr("tab.map"),
            L10n.tr("tab.discover"),
            L10n.tr("tab.profile"),
        ]

        tabBarController.viewControllers?.enumerated().forEach { index, controller in
            guard titles.indices.contains(index) else { return }
            controller.tabBarItem.title = titles[index]
        }
    }

    final class Coordinator: NSObject, UITabBarControllerDelegate {
        var selectedIndex: Binding<Int>
        let tabBarAlphaFix = TabBarAlphaFixDelegate()
        private var interactivePopDelegates: [InteractivePopDelegate] = []
        private var swipeBackCoordinators: [SwipeBackCoordinator] = []
        private var navigators: [UIKitNavigator] = []

        init(selectedIndex: Binding<Int>) {
            self.selectedIndex = selectedIndex
        }

        func retain(_ delegate: InteractivePopDelegate) {
            interactivePopDelegates.append(delegate)
        }

        func retain(_ coordinator: SwipeBackCoordinator) {
            swipeBackCoordinators.append(coordinator)
        }

        func retain(_ navigator: UIKitNavigator) {
            navigators.append(navigator)
        }

        func tabBarController(
            _ tabBarController: UITabBarController,
            didSelect viewController: UIViewController
        ) {
            if let idx = tabBarController.viewControllers?.firstIndex(of: viewController),
               selectedIndex.wrappedValue != idx {
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.selectedIndex.wrappedValue != idx else { return }
                    self.selectedIndex.wrappedValue = idx
                }
            }
            repairRootTabBarIfNeeded(in: tabBarController)
        }

        func repairRootTabBarIfNeeded(in tabBarController: UITabBarController) {
            tabBarController.viewControllers?
                .compactMap { $0 as? UINavigationController }
                .forEach { nav in
                    nav.interactivePopGestureRecognizer?.isEnabled = nav.viewControllers.count > 1
                }

            guard let nav = tabBarController.selectedViewController as? UINavigationController else {
                return
            }
            nav.repairNavigationSurface()
        }
    }
}
