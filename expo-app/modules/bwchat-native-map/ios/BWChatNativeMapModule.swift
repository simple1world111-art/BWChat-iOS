import Combine
import ExpoModulesCore
import MapKit
import SwiftUI
import UIKit

public final class BWChatNativeMapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BWChatNativeMap")

    View(BWChatNativeMapView.self) {
      Events("onRegionChange", "onMarkerPress")

      Prop("regionJSON") { (view, value: String) in
        view.setRegionJSON(value)
      }

      Prop("markersJSON") { (view, value: String) in
        view.setMarkersJSON(value)
      }

      Prop("localeIdentifier") { (view, value: String) in
        view.setLocaleIdentifier(value)
      }

    }
  }
}

public final class BWChatNativeMapView: ExpoView {
  let onRegionChange = EventDispatcher()
  let onMarkerPress = EventDispatcher()

  private let model: BWChatNativeMapModel
  private let hostingController: UIHostingController<BWChatNativeMapRootView>

  public required init(appContext: AppContext? = nil) {
    let model = BWChatNativeMapModel()
    self.model = model
    self.hostingController = UIHostingController(
      rootView: BWChatNativeMapRootView(model: model)
    )
    super.init(appContext: appContext)

    model.onRegionChange = { [weak self] region in
      self?.onRegionChange([
        "latitude": region.center.latitude,
        "longitude": region.center.longitude,
        "latitudeDelta": region.span.latitudeDelta,
        "longitudeDelta": region.span.longitudeDelta
      ])
    }
    model.onMarkerPress = { [weak self] userID in
      self?.onMarkerPress(["userId": userID])
    }

    let hostedView = hostingController.view!
    hostedView.backgroundColor = .clear
    hostedView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(hostedView)
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    scheduleLegalAttributionLayout()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    hostingController.view.frame = bounds
    applyLegalAttributionTabBarInset()
  }

  func setRegionJSON(_ value: String) {
    guard let data = value.data(using: .utf8),
          let payload = try? JSONDecoder().decode(BWChatMapRegionPayload.self, from: data),
          payload.isValid else { return }
    model.applyRegion(payload.mapRegion)
  }

  func setMarkersJSON(_ value: String) {
    guard let data = value.data(using: .utf8),
          let markers = try? JSONDecoder().decode([BWChatMapMarkerPayload].self, from: data) else {
      model.applyMarkers([])
      return
    }
    model.applyMarkers(markers.filter(\.hasValidCoordinate))
  }

  func setLocaleIdentifier(_ value: String) {
    model.applyLocaleIdentifier(value)
    scheduleLegalAttributionLayout()
  }

  private func scheduleLegalAttributionLayout() {
    for delay in [0.0, 0.1, 0.5, 1.0] {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.applyLegalAttributionTabBarInset()
      }
    }
  }

  private func applyLegalAttributionTabBarInset() {
    guard let mapView = hostingController.view.firstSubview(of: MKMapView.self),
          let tabBar = window?.firstSubview(of: UITabBar.self),
          !tabBar.isHidden,
          tabBar.alpha > 0 else { return }
    let legalAttributionBottomInset = tabBar.bounds.height
    var margins = mapView.layoutMargins
    guard margins.bottom != legalAttributionBottomInset else { return }
    margins.bottom = legalAttributionBottomInset
    mapView.layoutMargins = margins
    mapView.setNeedsLayout()
    mapView.layoutIfNeeded()
  }
}

private extension UIView {
  func firstSubview<T: UIView>(of type: T.Type) -> T? {
    if let match = self as? T { return match }
    for subview in subviews {
      if let match = subview.firstSubview(of: type) { return match }
    }
    return nil
  }
}

private struct BWChatMapRegionPayload: Decodable {
  let latitude: Double
  let longitude: Double
  let latitudeDelta: Double
  let longitudeDelta: Double

  var isValid: Bool {
    latitude.isFinite
      && longitude.isFinite
      && latitudeDelta.isFinite
      && longitudeDelta.isFinite
      && (-90...90).contains(latitude)
      && (-180...180).contains(longitude)
      && latitudeDelta > 0
      && longitudeDelta > 0
  }

  var mapRegion: MKCoordinateRegion {
    MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
      span: MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
    )
  }
}

private struct BWChatMapMarkerPayload: Decodable, Equatable, Identifiable {
  let id: String
  let userId: String?
  let latitude: Double
  let longitude: Double
  let avatarUrl: String
  let accessibilityLabel: String
  let isCurrentUser: Bool
  let isOnline: Bool

  var coordinate: CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
  }

  var hasValidCoordinate: Bool {
    latitude.isFinite
      && longitude.isFinite
      && (-90...90).contains(latitude)
      && (-180...180).contains(longitude)
      && (abs(latitude) > 0.000001 || abs(longitude) > 0.000001)
  }
}

private final class BWChatNativeMapModel: ObservableObject {
  @Published private(set) var region = MKCoordinateRegion(
    center: CLLocationCoordinate2D(latitude: 35.681236, longitude: 139.767125),
    span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
  )
  @Published private(set) var markers: [BWChatMapMarkerPayload] = []
  @Published private(set) var localeIdentifier = "zh-Hans"

  var onRegionChange: ((MKCoordinateRegion) -> Void)?
  var onMarkerPress: ((String) -> Void)?
  private var pendingRegionEvent: DispatchWorkItem?

  func regionBinding(viewportWidth: CGFloat) -> Binding<MKCoordinateRegion> {
    Binding(
      get: { self.displayRegion(for: self.region, viewportWidth: viewportWidth) },
      set: { [weak self] nextDisplayRegion in
        guard let self else { return }
        let nextRegion = self.logicalRegion(
          for: nextDisplayRegion,
          viewportWidth: viewportWidth
        )
        guard !self.region.isApproximatelyEqual(to: nextRegion) else { return }
        self.region = nextRegion
        self.scheduleRegionEvent(nextRegion)
      }
    )
  }

  func applyRegion(_ nextRegion: MKCoordinateRegion) {
    guard !region.isApproximatelyEqual(to: nextRegion) else { return }
    withAnimation(.easeInOut(duration: 0.3)) {
      region = nextRegion
    }
  }

  func applyMarkers(_ nextMarkers: [BWChatMapMarkerPayload]) {
    guard markers != nextMarkers else { return }
    markers = nextMarkers
  }

  func applyLocaleIdentifier(_ value: String) {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let nextValue = normalized.isEmpty ? "zh-Hans" : normalized
    guard localeIdentifier != nextValue else { return }
    localeIdentifier = nextValue
  }

  func markerPressed(_ marker: BWChatMapMarkerPayload) {
    guard !marker.isCurrentUser,
          let userID = marker.userId?.trimmingCharacters(in: .whitespacesAndNewlines),
          !userID.isEmpty else { return }
    onMarkerPress?(userID)
  }

  private func scheduleRegionEvent(_ nextRegion: MKCoordinateRegion) {
    pendingRegionEvent?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      self?.onRegionChange?(nextRegion)
    }
    pendingRegionEvent = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: workItem)
  }

  private func displayRegion(
    for logicalRegion: MKCoordinateRegion,
    viewportWidth: CGFloat
  ) -> MKCoordinateRegion {
    var displayRegion = logicalRegion
    displayRegion.center.latitude -= verticalCameraLatitudeOffset(
      for: logicalRegion,
      viewportWidth: viewportWidth
    )
    return displayRegion
  }

  private func logicalRegion(
    for displayRegion: MKCoordinateRegion,
    viewportWidth: CGFloat
  ) -> MKCoordinateRegion {
    var logicalRegion = displayRegion
    logicalRegion.center.latitude += verticalCameraLatitudeOffset(
      for: displayRegion,
      viewportWidth: viewportWidth
    )
    return logicalRegion
  }

  private func verticalCameraLatitudeOffset(
    for region: MKCoordinateRegion,
    viewportWidth: CGFloat
  ) -> CLLocationDegrees {
    let width = max(Double(viewportWidth), 1)
    let latitudeScale = max(abs(cos(region.center.latitude * .pi / 180)), 0.01)
    return region.span.longitudeDelta
      * latitudeScale
      / width
      * BWChatNativeMapRootView.verticalCameraOffsetPoints
  }

}

private struct BWChatNativeMapRootView: View {
  static let verticalCameraOffsetPoints = 32.0 / 3.0

  @ObservedObject var model: BWChatNativeMapModel

  var body: some View {
    GeometryReader { proxy in
      Map(
        coordinateRegion: model.regionBinding(viewportWidth: proxy.size.width),
        interactionModes: .all,
        showsUserLocation: false,
        annotationItems: model.markers
      ) { marker in
        MapAnnotation(coordinate: marker.coordinate) {
          if marker.isCurrentUser {
            BWChatMapAvatarMarker(marker: marker)
          } else {
            Button {
              model.markerPressed(marker)
            } label: {
              BWChatMapAvatarMarker(marker: marker)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(marker.accessibilityLabel)
          }
        }
      }
      .ignoresSafeArea(.container, edges: [.top, .bottom])
      .environment(\.locale, Locale(identifier: model.localeIdentifier))
      .id(model.localeIdentifier)
    }
  }
}

private struct BWChatMapAvatarMarker: View {
  let marker: BWChatMapMarkerPayload

  private var size: CGFloat { marker.isCurrentUser ? 46 : 40 }

  var body: some View {
    BWChatMapAvatar(url: marker.avatarUrl, size: size)
      .overlay(
        RoundedRectangle(
          cornerRadius: marker.isCurrentUser ? 10 : 9,
          style: .continuous
        )
        .stroke(Color.white, lineWidth: marker.isCurrentUser ? 4 : 3)
      )
      .overlay(alignment: .bottomTrailing) {
        if marker.isOnline {
          Circle()
            .fill(Color.green)
            .frame(
              width: marker.isCurrentUser ? 12 : 10,
              height: marker.isCurrentUser ? 12 : 10
            )
            .overlay(Circle().stroke(Color.white, lineWidth: 2))
        }
      }
      .shadow(color: Color.black.opacity(0.24), radius: 8, x: 0, y: 4)
      .accessibilityLabel(marker.accessibilityLabel)
  }
}

private struct BWChatMapAvatar: View {
  let url: String
  let size: CGFloat

  @State private var image: UIImage?

  var body: some View {
    Group {
      if let image {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
          .fill(
            LinearGradient(
              colors: [Color(hex: "667EEA"), Color(hex: "764BA2")],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            )
          )
          .overlay(
            Image(systemName: "person.fill")
              .foregroundColor(.white.opacity(0.8))
              .font(.system(size: size * 0.38, weight: .medium))
          )
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
    .task(id: url) {
      image = await loadImage()
    }
  }

  private func loadImage() async -> UIImage? {
    let normalized = url.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty, let imageURL = URL(string: normalized) else { return nil }
    do {
      let (data, response) = try await URLSession.shared.data(from: imageURL)
      guard !Task.isCancelled,
            let httpResponse = response as? HTTPURLResponse,
            (200...299).contains(httpResponse.statusCode) else { return nil }
      return UIImage(data: data)
    } catch {
      return nil
    }
  }
}

private extension MKCoordinateRegion {
  func isApproximatelyEqual(to other: MKCoordinateRegion) -> Bool {
    abs(center.latitude - other.center.latitude) < 0.000001
      && abs(center.longitude - other.center.longitude) < 0.000001
      && abs(span.latitudeDelta - other.span.latitudeDelta) < 0.000001
      && abs(span.longitudeDelta - other.span.longitudeDelta) < 0.000001
  }
}

private extension Color {
  init(hex: String) {
    let normalized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var value: UInt64 = 0
    Scanner(string: normalized).scanHexInt64(&value)
    self.init(
      .sRGB,
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255,
      opacity: 1
    )
  }
}
