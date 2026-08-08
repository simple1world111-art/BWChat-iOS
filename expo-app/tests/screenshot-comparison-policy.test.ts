import fs from "node:fs";
import path from "node:path";

describe("95 percent visual comparison policy", () => {
  it("uses a 95 percent floor and keeps functional parity as a separate gate", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/compare-screenshots.py"),
      "utf8",
    );
    expect(source).toContain("default=3");
    expect(source).toContain("default=0.95");
    expect(source).toContain("visual_ratio >= args.minimum_ratio");
    expect(source).toContain("Functional and backend parity require separate 1:1 verification.");
    expect(source).not.toContain("pixel-exact acceptance requires zero");
    expect(source).not.toContain("overlay-50.png");
    expect(source).not.toContain("changed-mask.png");
  });

  it("keeps generated evidence and build exports out of Metro's source scan", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "metro.config.js"), "utf8");
    expect(source).toContain("fromProjectRoot");
    expect(source).toContain('fromProjectRoot("dist(?:-');

    const projectRootPattern = process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const distRule = new RegExp(`^${projectRootPattern}[/\\\\]dist(?:-[^/\\\\]+)?[/\\\\].*`);
    const artifactsRule = new RegExp(`^${projectRootPattern}[/\\\\]artifacts[/\\\\].*`);

    expect(distRule.test(path.join(process.cwd(), "dist-ios", "bundle.js"))).toBe(true);
    expect(artifactsRule.test(path.join(process.cwd(), "artifacts", "proof.png"))).toBe(true);
    expect(
      distRule.test(path.join(process.cwd(), "node_modules", "memoize-one", "dist", "index.js")),
    ).toBe(false);
  });

  it("supports a fixed component crop so large flat backgrounds cannot inflate style evidence", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/compare-component-style.py"),
      "utf8",
    );
    expect(source).toContain('"--crop"');
    expect(source).toContain("nargs=4");
    expect(source).toContain('native.save(output / "native-crop.png")');
    expect(source).toContain('expo.save(output / "expo-crop.png")');
    expect(source).toContain('"crop": crop_metrics');
  });
});
