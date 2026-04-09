import SwiftUI

struct DiscoverView: View {
    var body: some View {
        NavigationStack {
            List {
                NavigationLink {
                    MomentsView()
                } label: {
                    discoverRow(
                        icon: "camera.fill",
                        title: "朋友圈",
                        gradient: [Color(hex: "667eea"), Color(hex: "764ba2")]
                    )
                }
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .background(AppColors.secondaryBackground)
            .navigationTitle("发现")
        }
    }

    private func discoverRow(icon: String, title: String, gradient: [Color]) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(LinearGradient(colors: gradient, startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 40, height: 40)
                Image(systemName: icon)
                    .font(.system(size: 17))
                    .foregroundColor(.white)
            }

            Text(title)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(AppColors.primaryText)

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
        }
        .padding(.vertical, 6)
    }
}
