import SwiftUI

struct DiscoverView: View {
    var body: some View {
        NavigationStack {
            List {
                NavigationLink {
                    MomentsView()
                } label: {
                    HStack(spacing: 14) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 10)
                                .fill(
                                    LinearGradient(
                                        colors: [Color(hex: "667eea"), Color(hex: "764ba2")],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .frame(width: 40, height: 40)
                            Image(systemName: "camera.fill")
                                .font(.system(size: 17))
                                .foregroundColor(.white)
                        }

                        Text("朋友圈")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(AppColors.primaryText)

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                    .padding(.vertical, 6)
                }
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .background(AppColors.secondaryBackground)
            .navigationTitle("发现")
        }
    }
}
