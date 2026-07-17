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
        pop(count: 1)
    }

    func pop(count: Int) {
        guard let navigationController else { return }
        performWhenReady(on: navigationController) { [weak navigationController] in
            guard let navigationController else { return }
            let viewControllers = navigationController.viewControllers
            if viewControllers.count > 1 {
                let targetIndex = max(
                    viewControllers.count - 1 - max(count, 1),
                    0
                )
                navigationController.popToViewController(
                    viewControllers[targetIndex],
                    animated: true
                )
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

private struct DynamicTabScreenRootView: View {
    let screenID: String
    let title: String

    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var screenStore: DynamicScreenStore
    @State private var routeAlert: DynamicRouteAlert?

    init(screenID: String, title: String) {
        self.screenID = screenID
        self.title = title
        self._screenStore = StateObject(wrappedValue: DynamicScreenStore(screenID: screenID))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Text(screenStore.screen?.displayTitle() ?? title)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundColor(AppColors.primaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, AppSpacing.rootTabTopInset)

                ForEach((screenStore.screen?.components ?? []).filter(\.isVisible)) { component in
                    DynamicComponentRenderer(component: component, onRoute: openRoute)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
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

    private func openRoute(_ route: DynamicRoute?) {
        switch DynamicRouteHandler.open(route, navigator: navigator, fallbackTitle: title) {
        case .handled:
            break
        case .alert(let alert):
            routeAlert = alert
        }
    }
}

private struct DynamicTabPlaceholderView: View {
    let title: String

    var body: some View {
        VStack(spacing: 14) {
            RootTabTitle(localizedKey: "tab.discover")
                .opacity(0)
                .frame(height: 1)

            Spacer()
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 38, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
            Text(L10n.tr("discover.comingSoon"))
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 24)
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
    }
}

final class NavigableHostingController: UIHostingController<AnyView> {
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateRootTabBarSafeArea()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.interactivePopGestureRecognizer?.isEnabled =
            (navigationController?.viewControllers.count ?? 0) > 1
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        navigationController?.repairNavigationSurface()
        updateRootTabBarSafeArea()
    }

    /// iOS 26's floating tab bar overlays child view controllers instead of
    /// contributing its full height to their safe area. Bridge the tab bar
    /// controller's unobscured content guide into SwiftUI so Lists can scroll
    /// their final row completely above the floating bar.
    private func updateRootTabBarSafeArea() {
        guard #available(iOS 26.0, *),
              let navigationController,
              navigationController.viewControllers.first === self,
              let tabBarController,
              !tabBarController.tabBar.isHidden
        else {
            if additionalSafeAreaInsets.bottom != 0 {
                additionalSafeAreaInsets.bottom = 0
            }
            return
        }

        let contentFrame = tabBarController.contentLayoutGuide.layoutFrame
        guard !contentFrame.isEmpty else { return }

        let unobscuredFrame = tabBarController.view.convert(contentFrame, to: view)
        let coveredBottomHeight = max(view.bounds.maxY - unobscuredFrame.maxY, 0)
        let systemBottomInset = max(view.safeAreaInsets.bottom - additionalSafeAreaInsets.bottom, 0)
        let requiredAdditionalInset = max(coveredBottomHeight - systemBottomInset, 0)

        guard abs(additionalSafeAreaInsets.bottom - requiredAdditionalInset) > 0.5 else { return }
        additionalSafeAreaInsets.bottom = requiredAdditionalInset
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
    let tabs: [DynamicTabDescriptor]
    let tabBadges: [String: Int]

    func makeCoordinator() -> Coordinator {
        Coordinator(selectedIndex: $selectedIndex)
    }

    func makeUIViewController(context: Context) -> UITabBarController {
        let tb = UITabBarController()
        tb.delegate = context.coordinator

        // Force a classic opaque tab bar appearance.
        // iOS 18 defaults to a minimizable/floating pill bar whose transition
        // animation on interactive pop occasionally snaps to fully-visible on
        // the first swipe (users see "two layers" before it settles). Opaque
        // + explicit appearance is the only reliably-in-sync variant.
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        tb.tabBar.standardAppearance = appearance
        tb.tabBar.scrollEdgeAppearance = appearance
        Self.applyTabBarSelectedColor(to: tb.tabBar)

        context.coordinator.tabSignature = Self.signature(for: tabs)
        tb.viewControllers = Self.makeTabs(from: tabs, coordinator: context.coordinator)
        tb.selectedIndex = min(selectedIndex, max((tb.viewControllers?.count ?? 1) - 1, 0))
        Self.applyTabItems(to: tb, tabs: tabs, badges: tabBadges)
        return tb
    }

    func updateUIViewController(_ tb: UITabBarController, context: Context) {
        let nextSignature = Self.signature(for: tabs)
        if context.coordinator.tabSignature != nextSignature {
            context.coordinator.resetRetainedNavigationObjects()
            context.coordinator.tabSignature = nextSignature
            tb.viewControllers = Self.makeTabs(from: tabs, coordinator: context.coordinator)
        }

        if selectedIndex >= (tb.viewControllers?.count ?? 0) {
            selectedIndex = max((tb.viewControllers?.count ?? 1) - 1, 0)
        }
        if tb.selectedIndex != selectedIndex {
            tb.selectedIndex = selectedIndex
        }
        _ = repairID
        _ = languageIdentifier
        Self.applyTabBarSelectedColor(to: tb.tabBar)
        Self.applyTabItems(to: tb, tabs: tabs, badges: tabBadges)
        context.coordinator.repairRootTabBarIfNeeded(in: tb)
    }

    private static func applyTabBarSelectedColor(to tabBar: UITabBar) {
        let selectedColor = legacySelectedTabColor
        let appearance = tabBar.standardAppearance

        [
            appearance.stackedLayoutAppearance,
            appearance.inlineLayoutAppearance,
            appearance.compactInlineLayoutAppearance
        ].forEach { itemAppearance in
            itemAppearance.normal.iconColor = nil
            itemAppearance.normal.titleTextAttributes = [:]
            itemAppearance.selected.iconColor = selectedColor
            itemAppearance.selected.titleTextAttributes = [.foregroundColor: selectedColor]
        }

        tabBar.tintColor = selectedColor
        tabBar.unselectedItemTintColor = nil
        tabBar.standardAppearance = appearance
        tabBar.scrollEdgeAppearance = appearance
    }

    private static func makeTabs(
        from tabs: [DynamicTabDescriptor],
        coordinator: Coordinator
    ) -> [UIViewController] {
        let usableTabs = tabs.isEmpty ? DynamicTabDescriptor.defaultTabs : tabs
        return usableTabs.map { descriptor in
            let legacyIcons = legacyIconNames(for: descriptor)
            let imageName = validatedSystemImage(legacyIcons?.image ?? descriptor.systemImage, fallback: "circle")
            let selectedName = validatedSystemImage(
                legacyIcons?.selected ?? descriptor.selectedSystemImage ?? descriptor.systemImage,
                fallback: "circle.fill"
            )
            return makeTab(
                root: rootView(for: descriptor),
                title: descriptor.displayTitle(),
                image: templateSymbol(named: imageName),
                selectedImage: templateSymbol(named: selectedName),
                coordinator: coordinator
            )
        }
    }

    private static func makeTab(
        root: AnyView,
        title: String,
        image: UIImage?,
        selectedImage: UIImage?,
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
            image: image,
            selectedImage: selectedImage
        )
        return nav
    }

    private static func applyTabItems(to tabBarController: UITabBarController, tabs: [DynamicTabDescriptor], badges: [String: Int]) {
        tabBarController.viewControllers?.enumerated().forEach { index, controller in
            guard tabs.indices.contains(index) else { return }
            let descriptor = tabs[index]
            let legacyIcons = legacyIconNames(for: descriptor)
            let imageName = validatedSystemImage(legacyIcons?.image ?? descriptor.systemImage, fallback: "circle")
            let selectedName = validatedSystemImage(
                legacyIcons?.selected ?? descriptor.selectedSystemImage ?? descriptor.systemImage,
                fallback: "circle.fill"
            )

            controller.tabBarItem.title = descriptor.displayTitle()
            controller.tabBarItem.image = templateSymbol(named: imageName)
            controller.tabBarItem.selectedImage = templateSymbol(named: selectedName)
            controller.tabBarItem.setTitleTextAttributes([.foregroundColor: legacySelectedTabColor], for: .selected)
            controller.tabBarItem.setTitleTextAttributes([:], for: .normal)
            let badgeCount = badgeCount(for: descriptor, badges: badges)
            controller.tabBarItem.badgeValue = badgeCount > 0 ? badgeText(badgeCount) : nil
            controller.tabBarItem.badgeColor = .systemRed
        }
    }

    private static func badgeCount(for descriptor: DynamicTabDescriptor, badges: [String: Int]) -> Int {
        let name = normalizedTabName(for: descriptor)
        if let count = badges[name] {
            return count
        }
        switch descriptor.badgeKey?.normalizedDynamicToken {
        case "messages_unread", "chat_unread", "conversations_unread", "messages":
            return badges["messages"] ?? 0
        case "moments_unread", "moments":
            return badges["discover"] ?? 0
        default:
            return 0
        }
    }

    private static func badgeText(_ count: Int) -> String {
        count > 99 ? "99+" : "\(count)"
    }

    private static func rootView(for descriptor: DynamicTabDescriptor) -> AnyView {
        let route = descriptor.route ?? DynamicRoute(type: descriptor.normalizedType, name: descriptor.id)
        let name = normalizedTabName(for: descriptor)

        switch name {
        case "messages":
            return AnyView(ContactListView())
        case "contacts":
            return AnyView(ContactsTabView())
        case "map", "nearby":
            return AnyView(MapDatingView(isRootTab: true))
        case "discover":
            return AnyView(DiscoverView())
        case "profile":
            return AnyView(ProfileView())
        default:
            switch route.normalizedType {
            case "screen":
                return AnyView(DynamicTabScreenRootView(
                    screenID: route.screenID ?? route.name ?? descriptor.id,
                    title: descriptor.displayTitle()
                ))
            case "web", "h5", "url":
                if let urlString = route.url,
                   let url = URL(string: urlString),
                   AppRemoteConfigStore.shared.config.webViewPolicy.allows(url) {
                    return AnyView(InAppWebView(url: url, title: descriptor.displayTitle()))
                }
                return AnyView(DynamicTabPlaceholderView(title: descriptor.displayTitle()))
            default:
                return AnyView(DynamicTabPlaceholderView(title: descriptor.displayTitle()))
            }
        }
    }

    private static func validatedSystemImage(_ name: String?, fallback: String) -> String {
        guard let name, UIImage(systemName: name) != nil else { return fallback }
        return name
    }

    private static var legacySelectedTabColor: UIColor {
        .black
    }

    private static func templateSymbol(named name: String) -> UIImage? {
        UIImage(systemName: name)?.withRenderingMode(.alwaysTemplate)
    }

    private static func normalizedTabName(for descriptor: DynamicTabDescriptor) -> String {
        let route = descriptor.route ?? DynamicRoute(type: descriptor.normalizedType, name: descriptor.id)
        return route.normalizedName.isEmpty ? descriptor.id.normalizedDynamicToken : route.normalizedName
    }

    private static func legacyIconNames(for descriptor: DynamicTabDescriptor) -> (image: String, selected: String)? {
        switch normalizedTabName(for: descriptor) {
        case "messages":
            return ("bubble.left.and.bubble.right", "bubble.left.and.bubble.right.fill")
        case "contacts":
            return ("person.crop.circle", "person.crop.circle.fill")
        case "map", "nearby":
            return ("map", "map.fill")
        case "discover":
            return ("safari", "safari.fill")
        case "profile":
            return ("gearshape", "gearshape.fill")
        default:
            return nil
        }
    }

    private static func signature(for tabs: [DynamicTabDescriptor]) -> String {
        tabs.map {
            [
                $0.id,
                $0.displayTitle(),
                $0.systemImage ?? "",
                $0.selectedSystemImage ?? "",
                $0.route?.normalizedType ?? "",
                $0.route?.name ?? "",
                $0.route?.url ?? "",
                $0.route?.screenID ?? ""
            ].joined(separator: ":")
        }
        .joined(separator: "|")
    }

    final class Coordinator: NSObject, UITabBarControllerDelegate {
        var selectedIndex: Binding<Int>
        let tabBarAlphaFix = TabBarAlphaFixDelegate()
        var tabSignature = ""
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

        func resetRetainedNavigationObjects() {
            interactivePopDelegates.removeAll()
            swipeBackCoordinators.removeAll()
            navigators.removeAll()
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
