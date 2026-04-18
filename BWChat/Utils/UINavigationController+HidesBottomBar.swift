// BWChat/Utils/UINavigationController+HidesBottomBar.swift
// Make `hidesBottomBarWhenPushed` work for SwiftUI NavigationStack pushes.

import UIKit
import ObjectiveC.runtime

/// SwiftUI's `NavigationStack` pushes UIHostingControllers onto an
/// underlying UINavigationController, but it does NOT set
/// `hidesBottomBarWhenPushed = true` on them — so UIKit's native
/// "hide the tab bar during push, slide it back on pop, adjust the
/// safe area" machinery never engages.
///
/// We can't intercept SwiftUI's construction of the hosting
/// controller, and trying to set the flag later (via a
/// UIViewControllerRepresentable's willMove / viewWillAppear / etc.)
/// is too late — UIKit reads the flag AT the moment pushViewController
/// is called, not afterward.
///
/// Solution: swizzle `pushViewController(_:animated:)` on
/// UINavigationController. Inside the swizzle, before handing off to
/// the original implementation, we set `hidesBottomBarWhenPushed =
/// true` on the pushed UIHostingController. This is the exact timing
/// UIKit needs, and it lets UIKit's native tab-bar machinery take
/// over completely — smooth slide animations in both directions,
/// correct safe area, and no breakage from app lifecycle events
/// (notifications, backgrounding, rotation) because the state is
/// UIKit-native rather than a transform hack.
///
/// Scoped to nav controllers that live inside a UITabBarController,
/// so other nav controllers elsewhere in the app (including anything
/// from third-party libs) are unaffected.
extension UINavigationController {
    /// Install the swizzle. Idempotent.
    static let installHidesBottomBarSwizzle: Void = {
        let originalSelector = #selector(pushViewController(_:animated:))
        let swizzledSelector = #selector(bwchat_swizzled_pushViewController(_:animated:))
        guard
            let originalMethod = class_getInstanceMethod(UINavigationController.self, originalSelector),
            let swizzledMethod = class_getInstanceMethod(UINavigationController.self, swizzledSelector)
        else { return }
        method_exchangeImplementations(originalMethod, swizzledMethod)
    }()

    @objc func bwchat_swizzled_pushViewController(_ viewController: UIViewController, animated: Bool) {
        // Only engage UIKit's hide-bottom-bar machinery if this nav
        // controller is actually nested inside a tab bar controller —
        // so we don't perturb unrelated nav stacks.
        if self.tabBarController != nil {
            viewController.hidesBottomBarWhenPushed = true
        }
        // After exchange, this selector routes to the ORIGINAL
        // pushViewController implementation. Call it so UIKit performs
        // the actual push, now with the flag set.
        bwchat_swizzled_pushViewController(viewController, animated: animated)
    }
}
