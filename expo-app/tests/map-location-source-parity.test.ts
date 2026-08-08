import fs from "node:fs";
import path from "node:path";

const expoRoot = process.cwd();
const nativeRoot = path.resolve(expoRoot, "..");

describe("login and map location source parity", () => {
  it("keeps the Swift 30 second, 100 meter and 12 second quality limits", () => {
    const swift = native("BWChat/Services/LoginLocationRecorder.swift");
    const service = expo("src/services/location/MapLocationService.ts");
    expect(swift).toContain("static let maximumAge: TimeInterval = 30");
    expect(swift).toContain("static let maximumHorizontalAccuracy: CLLocationAccuracy = 100");
    expect(swift).toContain("12_000_000_000");
    expect(service).toContain("maximumAgeMilliseconds: 30_000");
    expect(service).toContain("maximumHorizontalAccuracyMeters: 100");
    expect(service).toContain("requestTimeoutMilliseconds: 12_000");
  });

  it("preserves the exact update endpoint and six wire fields", () => {
    const swift = native("BWChat/Services/APIService.swift");
    const service = expo("src/services/location/MapLocationService.ts");
    for (const field of [
      "latitude",
      "longitude",
      "accuracy_m",
      "source",
      "event_id",
      "recorded_at",
    ]) {
      expect(swift).toContain(`"${field}"`);
      expect(service).toContain(`${field}:`);
    }
    expect(swift).toContain('path: "/map/me/location"');
    expect(service).toContain('apiRequest<unknown>("/map/me/location"');
    expect(service).toContain('method: "PUT"');
  });

  it("records only explicit login/register sessions and rechecks the active owner", () => {
    const swift = native("BWChat/Managers/AuthManager.swift");
    const provider = expo("src/providers/AuthProvider.tsx");
    const service = expo("src/services/location/MapLocationService.ts");
    expect(swift).toContain("LoginLocationRecorder.shared.recordAfterLogin");
    expect(provider).toMatch(/loginLocationRecorder\s*\.recordAfterLogin\(/u);
    expect(provider).toContain("authenticatedUserIdRef.current === candidate");
    expect(service.match(/isAuthenticated\(ownerId\)/gu)).toHaveLength(3);
  });

  it("uses one stable event per map visit and the same fresh quality gate", () => {
    const swift = native("BWChat/ViewModels/MapDatingViewModel.swift");
    const screen = expo("src/app/(tabs)/map.tsx");
    expect(swift).toContain("let eventID = mapVisitEventID");
    expect(swift).toContain("source: .mapVisit");
    expect(screen).toContain("const mapVisitEventId = randomUUID()");
    expect(screen).toContain('uploadMapLocation(location, "map_visit", mapVisitEventId)');
    expect(screen).toContain("requestFreshUsableLocation(5_000)");
  });

  it("preserves the dormant native map settings and disable contracts", () => {
    const swift = native("BWChat/Services/APIService.swift");
    const repository = expo("src/services/location/MapDatingRepository.ts");
    for (const path of ["/map/me/settings", "/map/me/disable"]) {
      expect(swift).toContain(`path: "${path}"`);
      expect(repository).toContain(`"${path}"`);
    }
    for (const field of ["visibility_scope", "online_status", "status_text"]) {
      expect(swift).toContain(`body["${field}"]`);
      expect(repository).toContain(`body.${field}`);
    }
  });

  it("keeps the original when-in-use permission declaration", () => {
    const swift = native("BWChat/Services/LoginLocationRecorder.swift");
    const config = expo("app.config.ts");
    expect(swift).toContain("requestWhenInUseAuthorization()");
    expect(config).toContain('"expo-location"');
    expect(config).toContain("locationWhenInUsePermission");
  });
});

function native(file: string): string {
  return fs.readFileSync(path.join(nativeRoot, file), "utf8");
}

function expo(file: string): string {
  return fs.readFileSync(path.join(expoRoot, file), "utf8");
}
