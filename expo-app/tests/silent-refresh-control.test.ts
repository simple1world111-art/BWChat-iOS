import fs from "node:fs";
import path from "node:path";

describe("SilentRefreshControl", () => {
  it("forwards the lifecycle while suppressing native platform visuals", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/ui/SilentRefreshControl.tsx"),
      "utf8",
    );

    expect(source).toContain("{...props}");
    expect(source).toContain('colors={["transparent"]}');
    expect(source).toContain('progressBackgroundColor="transparent"');
    expect(source).toContain('tintColor="transparent"');
    expect(source).toContain('titleColor="transparent"');
  });

  it("is the only refresh control imported by application surfaces", () => {
    const sourceRoot = path.join(process.cwd(), "src");
    const files = collectTypeScriptFiles(sourceRoot);
    const directNativeImports = files.filter((file) => {
      if (file.endsWith("SilentRefreshControl.tsx")) return false;
      const source = fs.readFileSync(file, "utf8");
      return /import[\s\S]*?RefreshControl[\s\S]*?from\s+["']react-native["']/u.test(source);
    });

    expect(directNativeImports).toEqual([]);
  });

  it("does not replace refresh actions with a visible progress animation", () => {
    const gate = fs.readFileSync(path.join(process.cwd(), "src/components/AppGate.tsx"), "utf8");

    expect(gate).not.toContain("ActivityIndicator");
    expect(gate).toContain("disabled={isRefreshing}");
    expect(gate).toContain("重新检查");
  });
});

function collectTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(resolved);
    return /\.tsx?$/u.test(entry.name) ? [resolved] : [];
  });
}
