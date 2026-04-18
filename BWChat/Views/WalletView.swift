// BWChat/Views/WalletView.swift
// Wallet (猫粮) mock page — recharge UI, no real backend.

import SwiftUI

struct WalletView: View {
    @State private var selectedTab = 0            // 0: 我的猫粮, 1: 创作收益
    @State private var selectedAmountIndex = 0
    @State private var agreedToTerms = false

    private let amounts: [(coins: Int, price: Int)] = [
        (100, 1), (800, 8), (1800, 18),
        (3000, 30), (9800, 98), (19800, 198)
    ]

    private var selectedPrice: Int { amounts[selectedAmountIndex].price }

    var body: some View {
        ZStack(alignment: .top) {
            LinearGradient(
                colors: [Color(hex: "FFF4C9"), Color(hex: "FFE69A")],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            PawPatternBackground()

            VStack(spacing: 0) {
                Spacer().frame(height: 20)

                pawIcon
                    .padding(.top, 8)

                VStack(spacing: 6) {
                    Text("猫粮余额")
                        .font(.system(size: 15))
                        .foregroundColor(.black.opacity(0.7))

                    Text("0")
                        .font(.system(size: 42, weight: .bold))
                        .foregroundColor(.black)

                    Button {
                        // mock
                    } label: {
                        HStack(spacing: 4) {
                            Text("明细清单")
                                .font(.system(size: 14))
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11))
                        }
                        .foregroundColor(.black.opacity(0.5))
                    }
                }
                .padding(.top, 10)

                Spacer()

                rechargePanel
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { tabHeader }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    // mock history
                } label: {
                    Image(systemName: "doc.text")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.black)
                }
            }
        }
        .toolbarBackground(Color(hex: "FFF4C9"), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
    }

    private var tabHeader: some View {
        HStack(spacing: 36) {
            tabButton("我的猫粮", index: 0)
            tabButton("创作收益", index: 1)
        }
    }

    private func tabButton(_ title: String, index: Int) -> some View {
        Button { selectedTab = index } label: {
            VStack(spacing: 3) {
                Text(title)
                    .font(.system(size: 17, weight: selectedTab == index ? .semibold : .regular))
                    .foregroundColor(.black)
                Rectangle()
                    .fill(selectedTab == index ? Color.black : Color.clear)
                    .frame(width: 22, height: 2)
            }
        }
    }

    private var pawIcon: some View {
        ZStack {
            Image(systemName: "sparkle")
                .font(.system(size: 14))
                .foregroundColor(.white)
                .offset(x: -54, y: -34)

            Image(systemName: "sparkle")
                .font(.system(size: 11))
                .foregroundColor(.white)
                .offset(x: 48, y: -38)

            Image(systemName: "sparkle")
                .font(.system(size: 9))
                .foregroundColor(.white)
                .offset(x: 54, y: 30)

            Image(systemName: "pawprint.fill")
                .font(.system(size: 78))
                .foregroundStyle(
                    LinearGradient(
                        colors: [Color(hex: "FFD54A"), Color(hex: "F0A020")],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .shadow(color: Color(hex: "F0A020").opacity(0.35), radius: 6, y: 3)
        }
        .frame(height: 110)
    }

    private var rechargePanel: some View {
        VStack(spacing: 14) {
            Button {
                // mock ad
            } label: {
                HStack(spacing: 10) {
                    ZStack {
                        Circle()
                            .fill(Color(hex: "FFD54A"))
                            .frame(width: 22, height: 22)
                        Image(systemName: "play.fill")
                            .font(.system(size: 9))
                            .foregroundColor(.white)
                            .offset(x: 1)
                    }

                    Text("看广告赚随机猫粮，还可看10次")
                        .font(.system(size: 13))
                        .foregroundColor(.black.opacity(0.75))

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11))
                        .foregroundColor(.black.opacity(0.4))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(hex: "FFEDB3"))
                )
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)

            LazyVGrid(columns: [
                GridItem(.flexible(), spacing: 10),
                GridItem(.flexible(), spacing: 10),
                GridItem(.flexible(), spacing: 10)
            ], spacing: 10) {
                ForEach(amounts.indices, id: \.self) { amountCard(index: $0) }
            }
            .padding(.horizontal, 16)

            Button {
                // mock recharge
            } label: {
                Text("立即充值 \(selectedPrice) 元")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(
                        RoundedRectangle(cornerRadius: 24)
                            .fill(Color(hex: "FFD54A"))
                    )
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)

            Button {
                agreedToTerms.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: agreedToTerms ? "checkmark.circle.fill" : "circle")
                        .foregroundColor(agreedToTerms ? Color(hex: "F0A020") : Color.gray.opacity(0.45))
                        .font(.system(size: 14))

                    Text("已阅读并同意")
                        .font(.system(size: 12))
                        .foregroundColor(.black.opacity(0.6))

                    Text("猫箱充值协议")
                        .font(.system(size: 12))
                        .foregroundColor(Color(hex: "F0A020"))
                }
            }
            .padding(.bottom, 8)
        }
        .padding(.bottom, 20)
        .background(
            Color.white
                .clipShape(TopRoundedShape(radius: 20))
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private func amountCard(index: Int) -> some View {
        let item = amounts[index]
        let selected = selectedAmountIndex == index
        return Button {
            selectedAmountIndex = index
        } label: {
            VStack(spacing: 4) {
                HStack(spacing: 4) {
                    Image(systemName: "pawprint.fill")
                        .font(.system(size: 12))
                        .foregroundColor(Color(hex: "F0A020"))
                    Text("\(item.coins)")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.black)
                }
                Text("¥\(item.price)")
                    .font(.system(size: 12))
                    .foregroundColor(.black.opacity(0.5))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(selected ? Color(hex: "FFF4C9") : Color.gray.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(selected ? Color(hex: "FFD54A") : Color.clear, lineWidth: 2)
                    )
            )
        }
    }
}

// Top-corner rounded shape for the recharge sheet
private struct TopRoundedShape: Shape {
    var radius: CGFloat
    func path(in rect: CGRect) -> Path {
        let p = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: [.topLeft, .topRight],
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(p.cgPath)
    }
}

// Subtle paw pattern behind the hero area
private struct PawPatternBackground: View {
    var body: some View {
        GeometryReader { geo in
            let step: CGFloat = 54
            let cols = Int(geo.size.width / step) + 1
            let rows = 6
            ZStack {
                ForEach(0..<rows, id: \.self) { row in
                    ForEach(0..<cols, id: \.self) { col in
                        Image(systemName: "pawprint.fill")
                            .font(.system(size: 22))
                            .foregroundColor(.white.opacity(0.35))
                            .position(
                                x: step * (CGFloat(col) + (row.isMultiple(of: 2) ? 0.35 : 0.85)),
                                y: step * CGFloat(row) + 40
                            )
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }
}
