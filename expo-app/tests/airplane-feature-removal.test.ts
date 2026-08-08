import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const productRoots = ["src", "modules", "assets/native-original"];
const forbiddenProductTokens = [
  /\/map\/flight-layer/iu,
  /flight_plane_/iu,
  /\bFlightLayer\b/iu,
  /\bflightLayer\b/iu,
  /\bairplane\b/iu,
  /飞机/iu,
];

describe("complete airplane product-feature removal", () => {
  it("contains no airplane route, model, UI token or copied flight asset in the Expo product", () => {
    const hits = productRoots.flatMap((root) =>
      walk(path.join(projectRoot, root)).flatMap((file) => {
        const relative = path.relative(projectRoot, file);
        const nameHit = forbiddenProductTokens.some((pattern) => pattern.test(relative));
        if (nameHit) return [relative];
        if (!/\.(?:[cm]?[jt]sx?|json|plist|podspec|swift)$/iu.test(file)) return [];
        const content = fs.readFileSync(file, "utf8");
        return forbiddenProductTokens.some((pattern) => pattern.test(content)) ? [relative] : [];
      }),
    );
    expect(hits).toEqual([]);
  });

  it("keeps the intentional API inventory exclusion and asset-count gate explicit", () => {
    const routeInventory = fs.readFileSync(
      path.join(projectRoot, "scripts/generate-api-route-inventory.mjs"),
      "utf8",
    );
    const contractInventory = fs.readFileSync(
      path.join(projectRoot, "scripts/generate-api-contract-inventory.mjs"),
      "utf8",
    );
    const assetGate = fs.readFileSync(
      path.join(projectRoot, "scripts/verify-native-assets.mjs"),
      "utf8",
    );
    expect(routeInventory).toContain('["/map/flight-layer"');
    expect(contractInventory).toContain('"/map/flight-layer"');
    expect(assetGate).toContain('const excludedAssetPrefixes = ["flight_plane_"]');
    expect(assetGate).toContain("const expectedFileCount = 45");
  });
});

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
