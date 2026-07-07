// BWChat/Components/ToastView.swift
// Non-intrusive toast notification

import SwiftUI

struct ToastModifier: ViewModifier {
    @Binding var message: String?
    let duration: TimeInterval

    func body(content: Content) -> some View {
        ZStack(alignment: .top) {
            content

            if let message = message {
                VStack {
                    Text(message)
                        .font(.subheadline)
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.black.opacity(0.75))
                        .cornerRadius(20)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .onAppear {
                            DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
                                withAnimation {
                                    self.message = nil
                                }
                            }
                        }

                    Spacer()
                }
                .animation(.easeInOut, value: message)
                .allowsHitTesting(false)
            }
        }
    }
}

struct CenterToastModifier: ViewModifier {
    @Binding var message: String?
    let duration: TimeInterval

    func body(content: Content) -> some View {
        ZStack {
            content

            if let message {
                Text(message)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 12)
                    .background(Color.black.opacity(0.78))
                    .cornerRadius(22)
                    .padding(.horizontal, 40)
                    .transition(.scale(scale: 0.94).combined(with: .opacity))
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
                            withAnimation {
                                self.message = nil
                            }
                        }
                    }
                    .allowsHitTesting(false)
            }
        }
        .animation(.easeInOut, value: message)
    }
}

extension View {
    func toast(message: Binding<String?>, duration: TimeInterval = 2.0) -> some View {
        modifier(ToastModifier(message: message, duration: duration))
    }

    func centerToast(message: Binding<String?>, duration: TimeInterval = 2.0) -> some View {
        modifier(CenterToastModifier(message: message, duration: duration))
    }
}
