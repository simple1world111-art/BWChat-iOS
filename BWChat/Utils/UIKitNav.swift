// BWChat/Utils/UIKitNav.swift
// UIKit tab bar controller + UIKit nav controllers with a SwiftUI-drawn
// tab bar overlay — the only way we found to avoid iOS 18's native
// UITabBar glitching on first interactive pop.
//
// Why not rely on UIKit's native tab bar + hidesBottomBarWhenPushed?
// On push with hidesBottomBarWhenPushed=true, UIKit EXTENDS the pushed
// VC's frame to cover the tab bar area, then animates the tab bar off.
// On pop, UIKit has to SHRINK the frame back to constrained height and
// restore the tab bar in lock-step. iOS 18's pill-style bar does this
// imperfectly on the first interactive pop — the shrink happens a frame
// early, exposing the real tab bar fully before the gesture has even
// moved (users see "two layers"). Subsequent pops are cached and fine.
//
// Fix: don't let UIKit manage the tab bar at all. Hide the native
// UITabBar, give every child VC the full screen, and overlay a
// SwiftUI tab bar at the bottom via `.safeAreaInset`. A shared
// `TabBarVisibility` @Published bool hides the overlay on push /
// shows it on pop, animated via `transitionCoordinator.animate` so
// the SwiftUI animation runs in sync with UIKit's transition.

import SwiftUI
import UIKit

// MARK: - Navigator

@MainActor
final class UIKitNavigator: ObservableObject {
    weak var navigationController: UINavigationController?

    func push<V: View>(_ view: V) {
        let host = UIHostingController(rootView: view.environmentObject(self))
        // Do NOT set hidesBottomBarWhenPushed. The native tab bar is hidden
        // globally; pushed VCs already get full-height frames.
        navigationController?.pushViewController(host, animated: true)
    }

    func pop() {
        navigationController?.popViewController(animated: true)
    }

    func popToRoot() {
        navigationController?.popToRootViewController(animated: true)
    }
}

// MARK: - Tab bar visibility state (SwiftUI-observable)

@MainActor
final class TabBarVisibility: ObservableObject {
    @Published var isHidden: Bool = false
}

// MARK: - Nav delegate: pushes/pops update TabBarVisibility

final class NavVisibilityDelegate: NSObject, UINavigationControllerDelegate {
    weak var visibility: TabBarVisibility?

    func navigationController(
        _ nc: UINavigationController,
        willShow vc: UIViewController,
        animated: Bool
    ) {
        // Target state: hidden when we're on anything but the root.
        // `viewControllers.last === vc` at willShow time (UIKit has
        // already swapped the stack), so count drives visibility.
        let shouldHide = nc.viewControllers.count > 1

        guard let visibility = visibility else { return }

        if animated, let coord = nc.transitionCoordinator {
            // Piggy-back on UIKit's transition animation so the SwiftUI
            // tab bar slide-out is in sync with the UIKit content slide.
            // For interactive pop, UIKit adjusts transitionDuration based
            // on the remaining gesture progress.
            let duration = coord.transitionDuration
            coord.animate(alongsideTransition: { _ in
                withAnimation(.easeInOut(duration: duration)) {
                    visibility.isHidden = shouldHide
                }
            }, completion: { ctx in
                if ctx.isCancelled {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        visibility.isHidden = !shouldHide
                    }
                }
            })
        } else {
            visibility.isHidden = shouldHide
        }
    }
}

// MARK: - Tab Bar Controller (native bar hidden)

struct MainTabController: UIViewControllerRepresentable {
    @Binding var selectedIndex: Int
    @ObservedObject var visibility: TabBarVisibility

    func makeCoordinator() -> Coordinator {
        Coordinator(selectedIndex: $selectedIndex, visibility: visibility)
    }

    func makeUIViewController(context: Context) -> UITabBarController {
        let tb = UITabBarController()
        tb.delegate = context.coordinator
        // Hide the native tab bar entirely — SwiftUI overlay draws our own.
        // Child VC frames get full screen as a result.
        tb.tabBar.isHidden = true

        tb.viewControllers = [
            Self.makeTab(root: ContactListView(), navDelegate: context.coordinator.navDelegate),
            Self.makeTab(root: ContactsTabView(), navDelegate: context.coordinator.navDelegate),
            Self.makeTab(root: DiscoverView(), navDelegate: context.coordinator.navDelegate),
            Self.makeTab(root: ProfileView(), navDelegate: context.coordinator.navDelegate),
        ]
        tb.selectedIndex = selectedIndex
        return tb
    }

    func updateUIViewController(_ tb: UITabBarController, context: Context) {
        if tb.selectedIndex != selectedIndex {
            tb.selectedIndex = selectedIndex
            // Crossing tabs can land on a nav with a non-root top VC:
            // reconcile visibility to match the new tab's depth.
            if let nav = tb.selectedViewController as? UINavigationController {
                visibility.isHidden = nav.viewControllers.count > 1
            }
        }
    }

    private static func makeTab<V: View>(
        root: V,
        navDelegate: UINavigationControllerDelegate
    ) -> UIViewController {
        let navigator = UIKitNavigator()
        let nav = UINavigationController()
        nav.navigationBar.prefersLargeTitles = true
        nav.delegate = navDelegate
        navigator.navigationController = nav

        let host = UIHostingController(rootView: AnyView(root.environmentObject(navigator)))
        nav.viewControllers = [host]
        return nav
    }

    final class Coordinator: NSObject, UITabBarControllerDelegate {
        var selectedIndex: Binding<Int>
        let visibility: TabBarVisibility
        let navDelegate = NavVisibilityDelegate()

        init(selectedIndex: Binding<Int>, visibility: TabBarVisibility) {
            self.selectedIndex = selectedIndex
            self.visibility = visibility
            super.init()
            self.navDelegate.visibility = visibility
        }

        func tabBarController(
            _ tabBarController: UITabBarController,
            didSelect viewController: UIViewController
        ) {
            if let idx = tabBarController.viewControllers?.firstIndex(of: viewController),
               selectedIndex.wrappedValue != idx {
                selectedIndex.wrappedValue = idx
            }
            if let nav = viewController as? UINavigationController {
                visibility.isHidden = nav.viewControllers.count > 1
            }
        }
    }
}

// MARK: - SwiftUI custom tab bar

struct CustomTabBar: View {
    @Binding var selectedIndex: Int

    struct Item {
        let title: String
        let icon: String
        let filled: String
    }

    private let items: [Item] = [
        Item(title: "消息", icon: "bubble.left.and.bubble.right", filled: "bubble.left.and.bubble.right.fill"),
        Item(title: "通讯录", icon: "person.crop.circle", filled: "person.crop.circle.fill"),
        Item(title: "发现", icon: "safari", filled: "safari.fill"),
        Item(title: "我", icon: "gearshape", filled: "gearshape.fill"),
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                Button {
                    selectedIndex = idx
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: selectedIndex == idx ? item.filled : item.icon)
                            .font(.system(size: 22))
                        Text(item.title)
                            .font(.system(size: 10))
                    }
                    .foregroundColor(selectedIndex == idx ? AppColors.accent : Color(.systemGray))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 6)
                    .padding(.bottom, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .background(
            Rectangle()
                .fill(Color(.systemBackground))
                .overlay(Divider(), alignment: .top)
                .ignoresSafeArea(edges: .bottom)
        )
    }
}
