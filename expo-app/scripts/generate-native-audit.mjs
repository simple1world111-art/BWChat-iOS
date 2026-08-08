#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(appRoot, "..");
const outputDir = join(appRoot, "docs");

function walk(directory, predicate = () => true) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? walk(path, predicate) : predicate(path) ? [path] : [];
    })
    .sort();
}

function text(path) {
  return readFileSync(path, "utf8");
}

function unique(values) {
  return [...new Set(values)].sort();
}

function matches(source, pattern, group = 1) {
  return [...source.matchAll(pattern)].map((match) => match[group]).filter(Boolean);
}

const swiftRoot = join(repositoryRoot, "BWChat");
const swiftFiles = walk(swiftRoot, (path) => path.endsWith(".swift"));
const categorizedFiles = swiftFiles.map((path) => {
  const source = text(path);
  const lines = source.split(/\r?\n/);
  const visualPattern = /\.(?:font|fontWeight|foregroundColor|foregroundStyle|tint|padding|frame|fixedSize|layoutPriority|position|offset|scaleEffect|rotationEffect|opacity|background|overlay|clipShape|cornerRadius|shadow|mask|blur|brightness|contrast|saturation|animation|transition|contentMargins|safeAreaInset|ignoresSafeArea|zIndex)\s*\(|Color\s*\(|Color\s*\.|Color\(hex:/;
  const interactionPattern = /\.(?:onTapGesture|onLongPressGesture|gesture|simultaneousGesture|highPriorityGesture|onChange|onAppear|onDisappear|task|sheet|fullScreenCover|alert|confirmationDialog|refreshable|searchable|swipeActions|contextMenu|onOpenURL|sensoryFeedback)\b/;
  return {
    file: relative(repositoryRoot, path),
    lines: lines.length,
    declarations: unique(
      matches(
        source,
        /^\s*(?:public\s+|private\s+|fileprivate\s+|internal\s+)?(?:final\s+)?(?:struct|class|enum|actor|protocol)\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
      ),
    ),
    state: unique(
      matches(
        source,
        /@(State|StateObject|ObservedObject|EnvironmentObject|Published)\b[^\n]*?\bvar\s+([A-Za-z_][A-Za-z0-9_]*)/g,
        2,
      ),
    ),
    visualModifiers: lines
      .map((line, index) => ({ line: index + 1, code: line.trim() }))
      .filter((item) => visualPattern.test(item.code)),
    interactionModifiers: lines
      .map((line, index) => ({ line: index + 1, code: line.trim() }))
      .filter((item) => interactionPattern.test(item.code)),
  };
});

const apiSource = text(join(swiftRoot, "Services", "APIService.swift"));
const apiFunctions = unique(
  matches(
    apiSource,
    /^\s*(?:private\s+|static\s+|@MainActor\s+|nonisolated\s+)*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]/gm,
  ),
);
const apiEndpoints = unique(
  matches(apiSource, /"(\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%\-]|\\\([^)]*\)|\/)+)"/g),
);

const dynamicRouteSource = text(join(swiftRoot, "Services", "DynamicRouteHandler.swift"));
const dynamicRoutes = unique(
  matches(dynamicRouteSource, /case\s+((?:"[^"]+"(?:,\s*)?)+)\s*:/g).flatMap((value) =>
    matches(value, /"([^"]+)"/g),
  ),
);

const testRoot = join(repositoryRoot, "BWChatTests");
const testFiles = walk(testRoot, (path) => path.endsWith(".swift")).map((path) => {
  const source = text(path);
  return {
    file: relative(repositoryRoot, path),
    tests: matches(source, /^\s*func\s+(test[A-Za-z0-9_]+)\s*\(/gm),
  };
});

const assetRoot = join(swiftRoot, "Assets.xcassets");
const assets = walk(assetRoot, (path) => basename(path) === "Contents.json")
  .map((path) => relative(assetRoot, dirname(path)))
  .filter((path) => path !== "");

const localizations = readdirSync(swiftRoot)
  .filter((entry) => entry.endsWith(".lproj"))
  .sort()
  .map((directory) => {
    const path = join(swiftRoot, directory, "Localizable.strings");
    const source = text(path);
    return {
      locale: directory.replace(/\.lproj$/, ""),
      keys: matches(source, /^\s*"([^"]+)"\s*=/gm).length,
    };
  });

const projectSource = text(join(repositoryRoot, "BWChat.xcodeproj", "project.pbxproj"));
const dependencies = unique(matches(projectSource, /repositoryURL = "([^"]+)"/g));
const infoPlistSource = text(join(swiftRoot, "Info.plist"));
const permissionKeys = unique(
  matches(infoPlistSource, /<key>((?:NS[A-Za-z]+UsageDescription)|UIBackgroundModes)<\/key>/g),
);

const audit = {
  generatedAt: new Date().toISOString(),
  repository: repositoryRoot,
  totals: {
    swiftFiles: swiftFiles.length,
    swiftLines: categorizedFiles.reduce((sum, item) => sum + item.lines, 0),
    views: categorizedFiles.filter((item) => item.file.startsWith("BWChat/Views/")).length,
    components: categorizedFiles.filter((item) => item.file.startsWith("BWChat/Components/")).length,
    viewModels: categorizedFiles.filter((item) => item.file.startsWith("BWChat/ViewModels/")).length,
    models: categorizedFiles.filter((item) => item.file.startsWith("BWChat/Models/")).length,
    services: categorizedFiles.filter((item) => item.file.startsWith("BWChat/Services/")).length,
    apiFunctions: apiFunctions.length,
    apiEndpoints: apiEndpoints.length,
    behaviorTests: testFiles.reduce((sum, item) => sum + item.tests.length, 0),
    assets: assets.length,
  },
  sourceFiles: categorizedFiles,
  apiFunctions,
  apiEndpoints,
  dynamicRoutes,
  tests: testFiles,
  assets,
  localizations,
  dependencies,
  permissionKeys,
};

function markdownList(values) {
  return values.length ? values.map((value) => `- \`${value}\``).join("\n") : "- （无）";
}

const sourceSections = [
  "Views",
  "Components",
  "ViewModels",
  "Models",
  "Services",
  "Managers",
  "Utils",
].map((category) => {
  const rows = categorizedFiles
    .filter((item) => item.file.startsWith(`BWChat/${category}/`))
    .map(
      (item) =>
        `| \`${item.file}\` | ${item.lines} | ${item.declarations.join(", ") || "—"} | ${item.state.join(", ") || "—"} |`,
    )
    .join("\n");
  return `## ${category}\n\n| 文件 | 行数 | 类型声明 | 状态字段 |\n|---|---:|---|---|\n${rows}`;
});

const testSections = testFiles
  .map((item) => `### ${item.file}\n\n${markdownList(item.tests)}`)
  .join("\n\n");

const viewModifierSections = categorizedFiles
  .filter((item) => item.file.startsWith("BWChat/Views/"))
  .map((item) => {
    const visual = item.visualModifiers.length
      ? item.visualModifiers.map((entry) => `- L${entry.line}: \`${entry.code.replaceAll("`", "\\`")}\``).join("\n")
      : "- （未识别到单行视觉 modifier，需结合嵌套 View/常量继续读取）";
    const interactions = item.interactionModifiers.length
      ? item.interactionModifiers.map((entry) => `- L${entry.line}: \`${entry.code.replaceAll("`", "\\`")}\``).join("\n")
      : "- （未识别到单行交互 modifier）";
    return `### ${item.file}\n\n视觉 modifier：\n\n${visual}\n\n交互 modifier：\n\n${interactions}`;
  })
  .join("\n\n");

const markdown = `# BWChat 原生工程自动审计清单

> 生成时间：${audit.generatedAt}  
> 生成脚本：\`expo-app/scripts/generate-native-audit.mjs\`  
> 本文只做事实枚举；完成状态见 \`migration-status.md\`。

## 汇总

| 项目 | 数量 |
|---|---:|
| Swift 文件 | ${audit.totals.swiftFiles} |
| Swift 行数（含空行） | ${audit.totals.swiftLines} |
| View 文件 | ${audit.totals.views} |
| Component 文件 | ${audit.totals.components} |
| ViewModel 文件 | ${audit.totals.viewModels} |
| Model 文件 | ${audit.totals.models} |
| Service 文件 | ${audit.totals.services} |
| API 函数 | ${audit.totals.apiFunctions} |
| API 路径模板 | ${audit.totals.apiEndpoints} |
| 行为测试 | ${audit.totals.behaviorTests} |
| Asset catalog 条目 | ${audit.totals.assets} |

${sourceSections.join("\n\n")}

## APIService 函数（全量）

${markdownList(apiFunctions)}

## API 路径模板（全量）

${markdownList(apiEndpoints)}

## 动态路由 token（全量）

${markdownList(dynamicRoutes)}

## 权限键

${markdownList(permissionKeys)}

## Swift Package 依赖

${markdownList(dependencies)}

## 本地化

| 语言 | Localizable key 数量 |
|---|---:|
${localizations.map((item) => `| ${item.locale} | ${item.keys} |`).join("\n")}

## Assets（全量）

${markdownList(assets)}

## 原生行为测试契约（全量）

${testSections}

## 原版 View 视觉与交互 modifier（代码级全量提取）

${viewModifierSections}
`;

writeFileSync(join(outputDir, "native-audit.generated.json"), `${JSON.stringify(audit, null, 2)}\n`);
writeFileSync(join(outputDir, "native-audit.generated.md"), markdown);
process.stdout.write(
  `Generated ${audit.totals.swiftFiles} Swift files, ${audit.totals.apiFunctions} API functions, and ${audit.totals.behaviorTests} behavior tests.\n`,
);
