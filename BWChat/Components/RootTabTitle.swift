import SwiftUI
import UIKit

struct RootTabTitle: View {
    static let leadingContentInset: CGFloat = 8

    private enum Source {
        case literal(String)
        case localizedKey(String)
    }

    private let source: Source
    @ObservedObject private var languageStore = AppLanguageStore.shared

    init(_ title: String) {
        self.source = .literal(title)
    }

    init(localizedKey: String) {
        self.source = .localizedKey(localizedKey)
    }

    private var title: String {
        _ = languageStore.activeLanguage.rawValue
        switch source {
        case .literal(let title):
            return title
        case .localizedKey(let key):
            return L10n.tr(key)
        }
    }

    var body: some View {
        Text(title)
            .font(.system(size: 22, weight: .semibold))
            .foregroundColor(AppColors.primaryText)
            .lineLimit(1)
            .minimumScaleFactor(0.78)
            .padding(.leading, Self.leadingContentInset)
            .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

struct SystemSegmentedTabs<Item: Identifiable & Equatable>: View {
    let items: [Item]
    @Binding var selection: Item
    let title: (Item) -> String
    var accessibilityIdentifier: String = "top.segmented.tabs"
    var fontWeight: UIFont.Weight = .regular

    var body: some View {
        NativeSegmentedControl(
            titles: items.map(title),
            selectedIndex: Binding(
                get: { items.firstIndex(of: selection) ?? 0 },
                set: { index in
                    guard items.indices.contains(index) else { return }
                    selection = items[index]
                }
            ),
            font: .systemFont(ofSize: 17, weight: fontWeight),
            accessibilityIdentifier: accessibilityIdentifier
        )
    }
}

private struct NativeSegmentedControl: UIViewRepresentable {
    let titles: [String]
    @Binding var selectedIndex: Int
    let font: UIFont
    let accessibilityIdentifier: String

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UISegmentedControl {
        let control = UISegmentedControl(items: titles)
        control.selectedSegmentIndex = selectedIndex
        control.accessibilityIdentifier = accessibilityIdentifier
        control.addTarget(
            context.coordinator,
            action: #selector(Coordinator.selectionChanged(_:)),
            for: .valueChanged
        )
        applyFont(to: control)
        return control
    }

    func updateUIView(_ control: UISegmentedControl, context: Context) {
        context.coordinator.parent = self
        if control.numberOfSegments != titles.count {
            control.removeAllSegments()
            for (index, title) in titles.enumerated() {
                control.insertSegment(withTitle: title, at: index, animated: false)
            }
        } else {
            for (index, title) in titles.enumerated() where control.titleForSegment(at: index) != title {
                control.setTitle(title, forSegmentAt: index)
            }
        }
        if control.selectedSegmentIndex != selectedIndex {
            control.selectedSegmentIndex = selectedIndex
        }
        control.accessibilityIdentifier = accessibilityIdentifier
        applyFont(to: control)
    }

    private func applyFont(to control: UISegmentedControl) {
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        control.setTitleTextAttributes(attributes, for: .normal)
        control.setTitleTextAttributes(attributes, for: .selected)
    }

    final class Coordinator: NSObject {
        var parent: NativeSegmentedControl

        init(parent: NativeSegmentedControl) {
            self.parent = parent
        }

        @objc func selectionChanged(_ sender: UISegmentedControl) {
            parent.selectedIndex = sender.selectedSegmentIndex
        }
    }
}
