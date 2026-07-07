// BWChat/Views/MapDatingView.swift
// Foreground-only nearby people experience.

import CoreLocation
import MapKit
import SwiftUI

struct MapDatingView: View {
    var isRootTab = false

    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var languageStore = AppLanguageStore.shared
    @StateObject private var viewModel = MapDatingViewModel()
    @State private var flightAircraft: [MapFlightAircraft] = []
    @State private var flightRoutes: [MapFlightRoute] = []
    @State private var selectedFlightID: String?
    @State private var flightPollingTask: Task<Void, Never>?
    @State private var pendingFlightRefreshTask: Task<Void, Never>?
    @State private var isFetchingFlightLayer = false
    @State private var isUsingMockFlightLayer = false
    @State private var flightLayerTTL: TimeInterval = FlightLayerExperiment.defaultRefreshInterval
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 35.681236, longitude: 139.767125),
        span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
    )
    private let flightAnimationTimer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    private var languageIdentifier: String {
        languageStore.activeLanguage.rawValue
    }

    private var mapRegionBinding: Binding<MKCoordinateRegion> {
        Binding(
            get: { region },
            set: { newRegion in
                guard !region.isApproximatelyEqual(to: newRegion) else { return }
                DispatchQueue.main.async {
                    guard !region.isApproximatelyEqual(to: newRegion) else { return }
                    region = newRegion
                    scheduleFlightLayerRefresh(for: newRegion)
                }
            }
        )
    }

    private var annotationItems: [MapDatingAnnotationItem] {
        var items: [MapDatingAnnotationItem] = []
        let currentUser = AuthManager.shared.currentUser

        if FlightLayerExperiment.isEnabled {
            items.append(contentsOf: flightAircraft.map { aircraft in
                MapDatingAnnotationItem(
                    id: "flight-\(aircraft.id)",
                    coordinate: aircraft.coordinate,
                    avatarURL: "",
                    isCurrentUser: false,
                    isOnline: false,
                    user: nil,
                    flight: aircraft
                )
            })
        }

        if let coordinate = viewModel.currentCoordinate {
            items.append(
                MapDatingAnnotationItem(
                    id: "current-user",
                    coordinate: coordinate,
                    avatarURL: currentUser?.avatarURL ?? "",
                    isCurrentUser: true,
                    isOnline: true,
                    user: nil,
                    flight: nil
                )
            )
        }

        let currentUserID = currentUser?.userID
        let userItems = viewModel.displayedUsers.compactMap { user -> MapDatingAnnotationItem? in
            guard user.userID != currentUserID,
                  let latitude = user.displayLat,
                  let longitude = user.displayLng else {
                return nil
            }
            return MapDatingAnnotationItem(
                id: user.userID,
                coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                avatarURL: user.avatarURL,
                isCurrentUser: false,
                isOnline: user.onlineStatus == MapOnlineStatus.online.rawValue,
                user: user,
                flight: nil
            )
        }

        items.append(contentsOf: userItems)
        return items
    }

    var body: some View {
        ZStack {
            mapLayer

            if viewModel.isLoading {
                ProgressView()
                    .tint(AppColors.accent)
                    .padding(18)
                    .background(AppColors.cardBackground)
                    .clipShape(Circle())
                    .shadow(color: Color.black.opacity(0.12), radius: 12, x: 0, y: 4)
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .modifier(MapDatingNavigationChrome(isRootTab: isRootTab))
        .task {
            await viewModel.loadInitial()
            startFlightLayerPolling()
        }
        .onDisappear {
            viewModel.pauseForegroundUpdates()
            stopFlightLayerPolling()
        }
        .onReceive(viewModel.$mapCenter) { coordinate in
            guard let coordinate else { return }
            withAnimation(.easeInOut(duration: 0.25)) {
                region.center = coordinate
            }
            scheduleFlightLayerRefresh(for: region, debounce: 0)
        }
        .onReceive(flightAnimationTimer) { _ in
            advanceMockFlightLayer()
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                viewModel.resumeForegroundUpdates()
                startFlightLayerPolling()
            } else {
                viewModel.pauseForegroundUpdates()
                stopFlightLayerPolling()
            }
        }
        .sheet(item: $viewModel.selectedUser) { user in
            MapUserDetailSheet(fallbackUser: user, viewModel: viewModel)
                .id(languageIdentifier)
                .environment(\.locale, languageStore.locale)
                .presentationDetents([.medium, .large])
        }
        .toast(message: $viewModel.successMessage)
        .toast(message: $viewModel.errorMessage)
    }

    private var mapLayer: some View {
        Map(
            coordinateRegion: mapRegionBinding,
            interactionModes: .all,
            showsUserLocation: false,
            annotationItems: annotationItems
        ) { item in
            MapAnnotation(coordinate: item.coordinate) {
                if let flight = item.flight {
                    FlightMarker(
                        aircraft: flight,
                        isSelected: selectedFlightID == flight.id
                    ) {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.78)) {
                            selectedFlightID = selectedFlightID == flight.id ? nil : flight.id
                        }
                    }
                    .zIndex(selectedFlightID == flight.id ? 1 : 0)
                } else if let user = item.user {
                    Button {
                        Task { await viewModel.selectUser(user) }
                    } label: {
                        MapAvatarMarker(
                            avatarURL: item.avatarURL,
                            isCurrentUser: false,
                            isOnline: item.isOnline
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(user.nickname)
                } else {
                    MapAvatarMarker(
                        avatarURL: item.avatarURL,
                        isCurrentUser: true,
                        isOnline: true
                    )
                    .accessibilityLabel(L10n.tr("map.myLocation"))
                }
            }
        }
        .ignoresSafeArea(.container, edges: [.top, .bottom])
        .environment(\.locale, languageStore.locale)
        .id(languageIdentifier)
        .overlay {
            if FlightLayerExperiment.isEnabled {
                FlightRouteOverlay(
                    region: region,
                    aircraft: flightAircraft,
                    routes: flightRoutes
                )
                .allowsHitTesting(false)
            }
        }
    }

    private func startFlightLayerPolling() {
        guard FlightLayerExperiment.isEnabled, flightPollingTask == nil else { return }
        flightPollingTask = Task { @MainActor in
            while !Task.isCancelled {
                await refreshFlightLayer(for: region, allowsMockFallback: true)
                let delay = max(FlightLayerExperiment.minimumRefreshInterval, min(flightLayerTTL, FlightLayerExperiment.maximumRefreshInterval))
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
    }

    private func stopFlightLayerPolling() {
        flightPollingTask?.cancel()
        flightPollingTask = nil
        pendingFlightRefreshTask?.cancel()
        pendingFlightRefreshTask = nil
        flightAircraft = []
        flightRoutes = []
        selectedFlightID = nil
        isUsingMockFlightLayer = false
    }

    private func scheduleFlightLayerRefresh(for targetRegion: MKCoordinateRegion, debounce: TimeInterval = 0.45) {
        guard FlightLayerExperiment.isEnabled else { return }
        pendingFlightRefreshTask?.cancel()
        pendingFlightRefreshTask = Task { @MainActor in
            if debounce > 0 {
                try? await Task.sleep(nanoseconds: UInt64(debounce * 1_000_000_000))
            }
            guard !Task.isCancelled else { return }
            await refreshFlightLayer(for: targetRegion, allowsMockFallback: false)
        }
    }

    private func refreshFlightLayer(for targetRegion: MKCoordinateRegion, allowsMockFallback: Bool) async {
        guard FlightLayerExperiment.isEnabled, !isFetchingFlightLayer else { return }
        isFetchingFlightLayer = true
        defer { isFetchingFlightLayer = false }

        do {
            let bounds = targetRegion.flightLayerBounds
            let response = try await APIService.shared.getMapFlightLayer(
                minLat: bounds.minLat,
                minLng: bounds.minLng,
                maxLat: bounds.maxLat,
                maxLng: bounds.maxLng,
                zoom: targetRegion.flightLayerZoom
            )

            withAnimation(.easeInOut(duration: 0.25)) {
                flightAircraft = response.aircraft
                flightRoutes = response.routes
                isUsingMockFlightLayer = false
                flightLayerTTL = TimeInterval(response.ttlSeconds)
                if let selectedFlightID,
                   !response.aircraft.contains(where: { $0.id == selectedFlightID }) {
                    self.selectedFlightID = nil
                }
            }
        } catch {
            guard allowsMockFallback, FlightLayerExperiment.allowsMockFallback, flightAircraft.isEmpty else { return }
            withAnimation(.easeInOut(duration: 0.25)) {
                flightAircraft = MapFlightAircraft.mockFixture(centeredAt: targetRegion.center)
                flightRoutes = []
                isUsingMockFlightLayer = true
                flightLayerTTL = FlightLayerExperiment.defaultRefreshInterval
            }
        }
    }

    private func advanceMockFlightLayer() {
        guard FlightLayerExperiment.isEnabled, isUsingMockFlightLayer, !flightAircraft.isEmpty else { return }
        withAnimation(.linear(duration: 3)) {
            flightAircraft = flightAircraft.map { $0.advanced(by: 3) }
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

    var flightLayerBounds: (minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
        let latPadding = span.latitudeDelta * 0.22
        let lngPadding = span.longitudeDelta * 0.22
        let minLat = max(-90, center.latitude - span.latitudeDelta / 2 - latPadding)
        let maxLat = min(90, center.latitude + span.latitudeDelta / 2 + latPadding)
        let minLng = max(-180, center.longitude - span.longitudeDelta / 2 - lngPadding)
        let maxLng = min(180, center.longitude + span.longitudeDelta / 2 + lngPadding)
        return (minLat, minLng, maxLat, maxLng)
    }

    var flightLayerZoom: Int {
        let longitudeDelta = max(0.0001, min(360, span.longitudeDelta))
        let rawZoom = log2(360 / longitudeDelta)
        return max(1, min(20, Int(rawZoom.rounded())))
    }
}

private struct MapDatingNavigationChrome: ViewModifier {
    let isRootTab: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isRootTab {
            content
                .navigationBarBackButtonHidden(true)
                .toolbar(.hidden, for: .navigationBar)
        } else {
            content
                .hidesTabBarOnPush()
                .navigationBarBackButtonHidden(true)
                .toolbar(.hidden, for: .navigationBar)
        }
    }
}

private struct MapDatingAnnotationItem: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let avatarURL: String
    let isCurrentUser: Bool
    let isOnline: Bool
    let user: MapUser?
    let flight: MapFlightAircraft?
}

private enum FlightLayerExperiment {
    static let isEnabled = false
    static let defaultRefreshInterval: TimeInterval = 15
    static let minimumRefreshInterval: TimeInterval = 8
    static let maximumRefreshInterval: TimeInterval = 30
#if DEBUG
    static let allowsMockFallback = true
#else
    static let allowsMockFallback = false
#endif
}

private extension MapFlightAircraft {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    var markerRotationDegrees: Double {
        heading - 90
    }

    var speedKmhText: String {
        "\(Int((speedMps * 3.6).rounded())) km/h"
    }

    var altitudeText: String {
        "\(Int(altitudeM.rounded())) m"
    }

    func advanced(by seconds: TimeInterval) -> MapFlightAircraft {
        let bearing = heading * .pi / 180
        let distanceKm = speedMps * seconds / 1_000
        let latDelta = cos(bearing) * distanceKm / 111
        let lngScale = max(0.2, cos(lat * .pi / 180))
        let lngDelta = sin(bearing) * distanceKm / (111 * lngScale)

        return MapFlightAircraft(
            id: id,
            callsign: callsign,
            lat: lat + latDelta,
            lng: lng + lngDelta,
            heading: heading,
            altitudeM: altitudeM,
            speedMps: speedMps,
            assetKey: assetKey,
            updatedAt: updatedAt,
            routePoints: routePoints
        )
    }

    func projectedRoutePoints() -> [MapFlightCoordinate] {
        guard routePoints.count < 2 else { return routePoints }
        let back = projectedCoordinate(seconds: -18 * 60)
        let ahead = projectedCoordinate(seconds: 28 * 60)
        return [
            MapFlightCoordinate(lat: back.latitude, lng: back.longitude),
            MapFlightCoordinate(lat: lat, lng: lng),
            MapFlightCoordinate(lat: ahead.latitude, lng: ahead.longitude)
        ]
    }

    private func projectedCoordinate(seconds: TimeInterval) -> CLLocationCoordinate2D {
        let bearing = heading * .pi / 180
        let distanceKm = speedMps * seconds / 1_000
        let latDelta = cos(bearing) * distanceKm / 111
        let lngScale = max(0.2, cos(lat * .pi / 180))
        let lngDelta = sin(bearing) * distanceKm / (111 * lngScale)
        return CLLocationCoordinate2D(latitude: lat + latDelta, longitude: lng + lngDelta)
    }

    static func mockFixture(centeredAt center: CLLocationCoordinate2D) -> [MapFlightAircraft] {
        let samples: [(String, Double, Double, Double, Double, Double, String)] = [
            ("BB101", 0.012, -0.028, 72, 9_700, 222, "flight_plane_blue"),
            ("BB205", -0.018, 0.024, 314, 8_900, 208, "flight_plane_pink"),
            ("BB318", 0.031, 0.008, 118, 10_800, 236, "flight_plane_gold"),
            ("BB426", -0.029, -0.016, 42, 7_600, 198, "flight_plane_green"),
            ("BB537", 0.006, 0.041, 256, 11_200, 244, "flight_plane_orange"),
            ("BB648", -0.043, 0.006, 16, 6_900, 184, "flight_plane_star"),
            ("BB759", 0.048, -0.052, 136, 10_300, 231, "flight_plane_blue"),
            ("BB862", -0.055, 0.049, 288, 9_100, 215, "flight_plane_pink"),
            ("BB974", 0.067, 0.036, 94, 12_000, 249, "flight_plane_gold"),
            ("BB083", -0.071, -0.041, 28, 7_300, 189, "flight_plane_green"),
            ("BB194", 0.083, -0.011, 204, 10_600, 229, "flight_plane_orange"),
            ("BB276", -0.088, 0.019, 338, 8_200, 202, "flight_plane_star"),
            ("BB329", 0.102, -0.076, 64, 9_900, 218, "flight_plane_blue"),
            ("BB431", -0.106, 0.073, 304, 8_700, 206, "flight_plane_pink"),
            ("BB542", 0.118, 0.061, 142, 11_600, 241, "flight_plane_gold"),
            ("BB653", -0.123, -0.063, 22, 6_800, 177, "flight_plane_green"),
            ("BB764", 0.138, -0.019, 232, 10_100, 226, "flight_plane_orange"),
            ("BB875", -0.141, 0.031, 348, 7_900, 195, "flight_plane_star"),
            ("BB986", 0.154, 0.092, 82, 12_400, 252, "flight_plane_blue"),
            ("BB097", -0.158, -0.091, 296, 9_400, 211, "flight_plane_pink"),
            ("BB208", 0.171, -0.044, 126, 10_900, 237, "flight_plane_gold"),
            ("BB319", -0.176, 0.048, 32, 7_100, 181, "flight_plane_green"),
            ("BB420", 0.193, 0.017, 218, 10_400, 224, "flight_plane_orange"),
            ("BB531", -0.198, -0.022, 356, 8_000, 196, "flight_plane_star")
        ]

        return samples.enumerated().map { index, sample in
            MapFlightAircraft(
                id: "mock-\(index)-\(sample.0)",
                callsign: sample.0,
                lat: center.latitude + sample.1,
                lng: center.longitude + sample.2,
                heading: sample.3,
                altitudeM: sample.4,
                speedMps: sample.5,
                assetKey: sample.6
            )
        }
    }
}

private struct FlightRouteLine: Identifiable {
    let id: String
    let points: [MapFlightCoordinate]
    let assetKey: String
}

private struct FlightRouteOverlay: View {
    let region: MKCoordinateRegion
    let aircraft: [MapFlightAircraft]
    let routes: [MapFlightRoute]

    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                for line in routeLines {
                    draw(line, in: &context, size: size)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    private var routeLines: [FlightRouteLine] {
        let aircraftByID = Dictionary(uniqueKeysWithValues: aircraft.map { ($0.id, $0) })
        var lines = routes.compactMap { route -> FlightRouteLine? in
            guard route.points.count >= 2 else { return nil }
            let linkedAircraft = route.aircraftID.flatMap { aircraftByID[$0] }
            return FlightRouteLine(
                id: "route-\(route.id)",
                points: route.points,
                assetKey: route.assetKey ?? linkedAircraft?.assetKey ?? "flight_plane_blue"
            )
        }

        let linkedRouteAircraftIDs = Set(routes.compactMap(\.aircraftID))
        let aircraftLines = aircraft.compactMap { item -> FlightRouteLine? in
            guard !linkedRouteAircraftIDs.contains(item.id) else { return nil }
            let points = item.projectedRoutePoints()
            guard points.count >= 2 else { return nil }
            return FlightRouteLine(
                id: "aircraft-route-\(item.id)",
                points: points,
                assetKey: item.assetKey
            )
        }

        lines.append(contentsOf: aircraftLines)
        return lines
    }

    private func draw(_ line: FlightRouteLine, in context: inout GraphicsContext, size: CGSize) {
        let screenPoints = line.points.compactMap { point(for: $0, size: size) }
        guard screenPoints.count >= 2 else { return }

        let path = routePath(from: screenPoints)
        let color = routeColor(for: line.assetKey)
        context.stroke(
            path,
            with: .color(color.opacity(0.18)),
            style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round)
        )
        context.stroke(
            path,
            with: .color(color.opacity(0.72)),
            style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [7, 6])
        )
    }

    private func routePath(from points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)

        if points.count == 2, let second = points.last {
            let control = curvedControlPoint(from: first, to: second)
            path.addQuadCurve(to: second, control: control)
            return path
        }

        for point in points.dropFirst() {
            path.addLine(to: point)
        }
        return path
    }

    private func curvedControlPoint(from start: CGPoint, to end: CGPoint) -> CGPoint {
        let dx = end.x - start.x
        let dy = end.y - start.y
        let distance = max(1, sqrt(dx * dx + dy * dy))
        let bend = min(90, max(18, distance * 0.14))
        return CGPoint(
            x: (start.x + end.x) / 2 - dy / distance * bend,
            y: (start.y + end.y) / 2 + dx / distance * bend
        )
    }

    private func point(for coordinate: MapFlightCoordinate, size: CGSize) -> CGPoint? {
        let latDelta = max(0.000001, region.span.latitudeDelta)
        let lngDelta = max(0.000001, region.span.longitudeDelta)
        let maxLat = region.center.latitude + latDelta / 2
        let minLng = region.center.longitude - lngDelta / 2

        let x = (coordinate.lng - minLng) / lngDelta * size.width
        let y = (maxLat - coordinate.lat) / latDelta * size.height
        let margin: CGFloat = 160
        guard x >= -margin, x <= size.width + margin, y >= -margin, y <= size.height + margin else {
            return nil
        }
        return CGPoint(x: x, y: y)
    }

    private func routeColor(for assetKey: String) -> Color {
        switch assetKey {
        case "flight_plane_blue": return Color(hex: "2786C5")
        case "flight_plane_pink": return Color(hex: "D94E83")
        case "flight_plane_gold": return Color(hex: "B96A18")
        case "flight_plane_green": return Color(hex: "2FAE88")
        case "flight_plane_orange": return Color(hex: "D85D34")
        case "flight_plane_star": return Color(hex: "5C96D8")
        default: return AppColors.accent
        }
    }
}

private struct FlightMarker: View {
    let aircraft: MapFlightAircraft
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            FlightAssetIcon(assetKey: aircraft.assetKey, size: isSelected ? 40 : 34)
                .rotationEffect(.degrees(aircraft.markerRotationDegrees))
                .animation(.spring(response: 0.28, dampingFraction: 0.78), value: isSelected)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) {
            if isSelected {
                FlightInfoBubble(aircraft: aircraft)
                    .offset(y: -48)
                    .transition(.scale(scale: 0.92).combined(with: .opacity))
            }
        }
        .accessibilityLabel("Flight \(aircraft.callsign)")
    }
}

private struct FlightAssetIcon: View {
    let assetKey: String
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            Circle()
                .fill(haloColor.opacity(0.16))
                .frame(width: size * 0.88, height: size * 0.88)
                .blur(radius: size * 0.08)
                .offset(y: size * 0.08)

            Circle()
                .fill(Color.white.opacity(0.94))
                .frame(width: size * 0.74, height: size * 0.74)
                .shadow(color: Color.black.opacity(0.05), radius: size * 0.08, x: 0, y: size * 0.04)

            artwork
                .frame(width: size * 1.2, height: size * 1.2)
        }
        .frame(width: size, height: size)
        .shadow(color: outlineColor.opacity(0.2), radius: size * 0.08, x: 0, y: size * 0.04)
    }

    private var artworkName: String? {
        switch assetKey {
        case "flight_plane_blue",
             "flight_plane_pink",
             "flight_plane_gold",
             "flight_plane_green",
             "flight_plane_orange",
             "flight_plane_star":
            return assetKey
        default:
            return nil
        }
    }

    @ViewBuilder
    private var artwork: some View {
        if let artworkName {
            Image(artworkName)
                .resizable()
                .interpolation(.high)
                .antialiased(true)
                .scaledToFit()
        } else {
            Image(systemName: "airplane")
                .resizable()
                .scaledToFit()
                .foregroundColor(AppColors.accent)
                .padding(size * 0.26)
        }
    }

    private var haloColor: Color {
        switch assetKey {
        case "flight_plane_blue": return Color(hex: "57BFEF")
        case "flight_plane_pink": return Color(hex: "FF7AAE")
        case "flight_plane_gold": return Color(hex: "FFC94A")
        case "flight_plane_green": return Color(hex: "67D6B3")
        case "flight_plane_orange": return Color(hex: "FF8A5B")
        case "flight_plane_star": return Color(hex: "8EC7FF")
        default: return AppColors.accent
        }
    }

    private var outlineColor: Color {
        switch assetKey {
        case "flight_plane_blue": return Color(hex: "2786C5")
        case "flight_plane_pink": return Color(hex: "D94E83")
        case "flight_plane_gold": return Color(hex: "B96A18")
        case "flight_plane_green": return Color(hex: "2FAE88")
        case "flight_plane_orange": return Color(hex: "D85D34")
        case "flight_plane_star": return Color(hex: "5C96D8")
        default: return AppColors.accent
        }
    }
}

private struct FlightInfoBubble: View {
    let aircraft: MapFlightAircraft

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(aircraft.callsign)
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(AppColors.primaryText)
                .lineLimit(1)

            HStack(spacing: 8) {
                metric(systemName: "speedometer", text: aircraft.speedKmhText)
                metric(systemName: "arrow.up.right", text: aircraft.altitudeText)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(Color.white.opacity(0.96))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.black.opacity(0.06), lineWidth: 1)
        )
        .cornerRadius(8)
        .shadow(color: Color.black.opacity(0.16), radius: 8, x: 0, y: 4)
    }

    private func metric(systemName: String, text: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: systemName)
                .font(.system(size: 9, weight: .bold))
            Text(text)
                .font(.system(size: 10, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundColor(AppColors.secondaryText)
    }
}

private struct MapAvatarMarker: View {
    let avatarURL: String
    let isCurrentUser: Bool
    let isOnline: Bool

    var body: some View {
        AvatarView(url: avatarURL, size: isCurrentUser ? 46 : 40)
            .overlay(
                Circle()
                    .stroke(Color.white, lineWidth: isCurrentUser ? 4 : 3)
            )
            .overlay(alignment: .bottomTrailing) {
                if isOnline {
                    Circle()
                        .fill(Color.green)
                        .frame(width: isCurrentUser ? 12 : 10, height: isCurrentUser ? 12 : 10)
                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                }
            }
            .shadow(color: Color.black.opacity(0.24), radius: 8, x: 0, y: 4)
    }
}

private struct MapUserDetailSheet: View {
    let fallbackUser: MapUser
    @ObservedObject var viewModel: MapDatingViewModel
    @ObservedObject private var languageStore = AppLanguageStore.shared
    @State private var showReportReasons = false

    private var user: MapUser {
        viewModel.selectedUser ?? fallbackUser
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                profileHeader
                infoCard
                actionButtons
            }
            .padding(20)
        }
        .background(AppColors.secondaryBackground)
        .id(languageStore.activeLanguage.rawValue)
        .confirmationDialog(L10n.tr("map.reportReason"), isPresented: $showReportReasons, titleVisibility: .visible) {
            ForEach(MapReportReason.allCases) { reason in
                Button(reason.title, role: reason == .other ? nil : .destructive) {
                    Task { await viewModel.reportUser(user, reason: reason) }
                }
            }
            Button(L10n.tr("common.cancel"), role: .cancel) {}
        }
    }

    private var profileHeader: some View {
        VStack(spacing: 12) {
            AvatarView(url: user.avatarURL, size: 72)

            VStack(spacing: 6) {
                Text(user.nickname)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    detailPill(user.onlineStatus == MapOnlineStatus.online.rawValue ? L10n.tr("map.online") : L10n.tr("map.invisible"))
                    if let gender = user.gender, !gender.isBlank {
                        detailPill(genderText(gender))
                    }
                    if let age = user.age {
                        detailPill(L10n.tr("map.age", age))
                    }
                    if let distanceText = user.distanceText, !distanceText.isBlank {
                        detailPill(distanceText)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var infoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let statusText = user.statusText, !statusText.isBlank {
                infoRow(title: L10n.tr("map.status"), value: statusText)
            }
            if let bio = user.bio, !bio.isBlank {
                infoRow(title: L10n.tr("map.bio"), value: bio)
            }
            if let profileLocation = user.profileLocation, !profileLocation.isBlank {
                infoRow(title: L10n.tr("map.profileLocation"), value: profileLocation)
            }
            if let lastActiveAt = user.lastActiveAt, !lastActiveAt.isBlank {
                infoRow(title: L10n.tr("map.lastActive"), value: lastActiveAt)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }

    private var actionButtons: some View {
        VStack(spacing: 10) {
            friendAction

            if user.relation == "blocked" {
                Button {
                    Task { await viewModel.unblockUser(user) }
                } label: {
                    actionLabel(L10n.tr("map.unblock"), color: AppColors.accent, filled: false)
                }
            } else {
                Button {
                    Task { await viewModel.blockUser(user) }
                } label: {
                    actionLabel(L10n.tr("map.block"), color: AppColors.errorColor, filled: false)
                }
            }

            Button {
                showReportReasons = true
            } label: {
                actionLabel(L10n.tr("map.report"), color: AppColors.warningColor, filled: false)
            }
        }
    }

    @ViewBuilder
    private var friendAction: some View {
        switch user.relation {
        case "friend":
            actionLabel(L10n.tr("addFriend.alreadyFriends"), color: AppColors.secondaryText, filled: false)
        case "pending_sent":
            actionLabel(L10n.tr("addFriend.sent"), color: AppColors.secondaryText, filled: false)
        case "blocked":
            actionLabel(L10n.tr("map.blocked"), color: AppColors.secondaryText, filled: false)
        default:
            Button {
                Task { await viewModel.sendFriendRequest(to: user) }
            } label: {
                actionLabel(L10n.tr("addFriend.title"), color: AppColors.accent, filled: true)
            }
        }
    }

    private func actionLabel(_ text: String, color: Color, filled: Bool) -> some View {
        Text(text)
            .font(.system(size: 16, weight: .bold))
            .foregroundColor(filled ? .white : color)
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .background(filled ? AnyShapeStyle(AppColors.accentGradient) : AnyShapeStyle(color.opacity(0.1)))
            .cornerRadius(23)
    }

    private func infoRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
            Text(value)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(AppColors.primaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func detailPill(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(AppColors.secondaryText)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(AppColors.cardBackground)
            .cornerRadius(12)
    }

    private func genderText(_ raw: String) -> String {
        switch raw.lowercased() {
        case "male", "m": return L10n.tr("profile.gender.male")
        case "female", "f": return L10n.tr("profile.gender.female")
        default: return raw
        }
    }
}
