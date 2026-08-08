#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = resolve(appRoot, "..", "BWChat");
const apiServicePath = join(nativeRoot, "Services", "APIService.swift");
const outputJSON = join(appRoot, "docs", "api-route-inventory.generated.json");
const outputMarkdown = join(appRoot, "docs", "api-route-inventory.generated.md");

const intentionalExclusions = new Map([
  ["/api/v1/games", "仅用于 Debug 路径诊断的前缀，不是独立请求路由"],
  ["/rounds", "仅用于 Debug 路径诊断的后缀，不是独立请求路由"],
  ["/map/flight-layer", "用户明确要求删除飞机功能；不属于 Expo 复刻范围"],
]);

const configuredRouteEvidence = new Map([
  [
    "/app/config",
    {
      file: "src/services/remote-config/RemoteConfigService.ts",
      evidence: "fetch(env.remoteConfigUrl",
    },
  ],
  [
    "/app/screens/:param",
    {
      file: "src/services/dynamic-screen/DynamicScreenRepository.ts",
      evidence: "/app/screens/${encodeURIComponent(screenId)}",
    },
  ],
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
    })
    .sort();
}

function canonicalRoute(value) {
  return value
    .replace(/\\\([^\n]*?\)\)?/gu, ":param")
    .replace(/\$\{[^}]*\}/gu, ":param")
    .split("?", 1)[0]
    .replace(/\/+$/u, "")
    .replace(/\/+/gu, "/");
}

function routeShapeCovers(candidate, reference) {
  const candidateParts = candidate.split("/").filter(Boolean);
  const referenceParts = reference.split("/").filter(Boolean);
  return (
    candidateParts.length === referenceParts.length &&
    candidateParts.every((part, index) => {
      const referencePart = referenceParts[index];
      return part === referencePart || referencePart === ":param";
    })
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

const nativeSource = readFileSync(apiServicePath, "utf8");
const nativeRoutes = uniqueSorted(
  [...nativeSource.matchAll(/"(\/[^"\n]+)"/gu)].map((match) => canonicalRoute(match[1])),
);

const sourceRoots = ["api", "services", "providers", "components"]
  .map((name) => join(appRoot, "src", name))
  .filter((path) => statSync(path).isDirectory());
const expoFiles = sourceRoots.flatMap(walk);
const expoReferences = new Map();

for (const path of expoFiles) {
  const source = readFileSync(path, "utf8");
  if (!/(?:apiRequest|fetch|remoteConfigUrl|apiBaseUrl)/u.test(source)) continue;
  for (const match of source.matchAll(/["`](\/[^"`\n]+)["`]/gu)) {
    const route = canonicalRoute(match[1]);
    const files = expoReferences.get(route) ?? new Set();
    files.add(relative(appRoot, path));
    expoReferences.set(route, files);
  }
}

for (const [route, evidence] of configuredRouteEvidence) {
  const source = readFileSync(join(appRoot, evidence.file), "utf8");
  if (!source.includes(evidence.evidence)) {
    throw new Error(`Configured route evidence disappeared: ${route} -> ${evidence.evidence}`);
  }
  const files = expoReferences.get(route) ?? new Set();
  files.add(evidence.file);
  expoReferences.set(route, files);
}

const excluded = nativeRoutes
  .filter((route) => intentionalExclusions.has(route))
  .map((route) => ({ route, reason: intentionalExclusions.get(route) }));
const inScopeNativeRoutes = nativeRoutes.filter((route) => !intentionalExclusions.has(route));
const expoRouteList = [...expoReferences.keys()].sort();
const covered = inScopeNativeRoutes.filter((nativeRoute) =>
  expoRouteList.some((expoRoute) => routeShapeCovers(nativeRoute, expoRoute)),
);
const candidateMissing = inScopeNativeRoutes.filter(
  (nativeRoute) => !covered.includes(nativeRoute),
);

const inventory = {
  generatedAt: new Date().toISOString(),
  nativeSource: relative(appRoot, apiServicePath),
  totals: {
    nativeRouteTemplates: nativeRoutes.length,
    intentionalExclusions: excluded.length,
    inScopeNativeRouteTemplates: inScopeNativeRoutes.length,
    expoNetworkRouteReferences: expoRouteList.length,
    sourceReferenceCandidatesCovered: covered.length,
    sourceReferenceCandidatesMissing: candidateMissing.length,
  },
  warning:
    "字符串/路由形状匹配只用于发现候选缺口，不证明 method、auth、body、envelope、错误、缓存或生命周期已经完成。",
  intentionalExclusions: excluded,
  covered,
  candidateMissing,
  expoReferences: Object.fromEntries(
    [...expoReferences.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([route, files]) => [route, [...files].sort()]),
  ),
};

const missingRows = candidateMissing.length
  ? candidateMissing
      .map((route) => `| \`${route}\` | 待逐项对照 Swift 调用与 Expo 实现 |`)
      .join("\n")
  : "| — | 路由引用候选无缺口；仍需做完整合同审计 |";
const excludedRows = excluded.map((item) => `| \`${item.route}\` | ${item.reason} |`).join("\n");

const markdown = `# Swift→Expo 后端 API 路由库存

> 生成时间：${inventory.generatedAt}  
> 生成脚本：\`scripts/generate-api-route-inventory.mjs\`

本报告只做第一层路由引用缺口发现。路由被找到不等于功能完成；每个功能仍必须继续核对 method、鉴权、body、幂等、分页、成功 envelope、错误、缓存、账号隔离、并发/重试、生命周期与状态回写。

## 汇总

| 项目 | 数量 |
|---|---:|
| Swift 路由模板 | ${inventory.totals.nativeRouteTemplates} |
| 用户明确排除/非独立路由 | ${inventory.totals.intentionalExclusions} |
| 本次复刻范围内 Swift 路由 | ${inventory.totals.inScopeNativeRouteTemplates} |
| Expo 网络层路由引用 | ${inventory.totals.expoNetworkRouteReferences} |
| 路由形状已有引用 | ${inventory.totals.sourceReferenceCandidatesCovered} |
| 候选缺口 | ${inventory.totals.sourceReferenceCandidatesMissing} |

## 候选缺口

| Swift 路由 | 状态 |
|---|---|
${missingRows}

## 明确排除

| 路由/片段 | 原因 |
|---|---|
${excludedRows}
`;

writeFileSync(
  outputJSON,
  await format(`${JSON.stringify(inventory, null, 2)}\n`, {
    parser: "json",
    printWidth: 100,
  }),
);
writeFileSync(outputMarkdown, await format(markdown, { parser: "markdown", printWidth: 100 }));
process.stdout.write(
  `API route inventory: ${covered.length}/${inScopeNativeRoutes.length} referenced, ${candidateMissing.length} candidates missing.\n`,
);
