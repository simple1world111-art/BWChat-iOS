// BWChat/Components/LoadingView.swift
// Reusable loading overlay

import SwiftUI

struct LoadingView: View {
    var message: String = L10n.tr("common.loading")

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(message)
                .font(.caption)
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppColors.background.opacity(0.8))
    }
}
