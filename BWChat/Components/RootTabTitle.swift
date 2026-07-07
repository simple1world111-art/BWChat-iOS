import SwiftUI

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
