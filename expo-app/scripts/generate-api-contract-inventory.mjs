#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = resolve(appRoot, "..", "BWChat");
const apiServicePath = join(nativeRoot, "Services", "APIService.swift");
const outputJSON = join(appRoot, "docs", "api-contract-inventory.generated.json");
const outputMarkdown = join(appRoot, "docs", "api-contract-inventory.generated.md");

const excludedRoutes = new Set(["/api/v1/games", "/rounds", "/map/flight-layer"]);
const directSwiftHelpers = new Map([
  ["get", "GET"],
  ["postJSON", "POST"],
  ["putJSON", "PUT"],
  ["patchJSON", "PATCH"],
]);
const configuredExpoContracts = [
  {
    route: "/app/config",
    method: "GET",
    file: "src/services/remote-config/RemoteConfigService.ts",
    noCache: true,
  },
  {
    route: "/app/screens/:param",
    method: "GET",
    file: "src/services/dynamic-screen/DynamicScreenRepository.ts",
    noCache: true,
  },
  {
    route: "/map/users",
    method: "GET",
    file: "src/services/location/MapDatingRepository.ts",
    noCache: true,
  },
  {
    route: "/map/users/:param",
    method: "GET",
    file: "src/services/location/MapDatingRepository.ts",
    noCache: true,
  },
  {
    route: "/follows/following",
    method: "GET",
    file: "src/api/bwchat.ts",
  },
  {
    route: "/follows/followers",
    method: "GET",
    file: "src/api/bwchat.ts",
  },
  {
    route: "/short-drama/videos/:param/like",
    method: "POST",
    file: "src/api/bwchat.ts",
  },
  {
    route: "/short-drama/videos/:param/like",
    method: "DELETE",
    file: "src/api/bwchat.ts",
  },
];
const configuredSwiftMethodOverrides = new Map([
  ["sendImageMessage|/chat/messages/image", "POST"],
  ["sendVideoMessage|/chat/messages/video", "POST"],
  ["sendGroupImage|/groups/:param/messages/image", "POST"],
  ["sendGroupVideo|/groups/:param/messages/video", "POST"],
  ["uploadOneToOneLiveAvatar|/one-to-one-live/assets/avatar", "POST"],
  ["forwardMessages|/chat/forwards", "POST"],
  ["uploadAvatar|/profile/avatar", "POST"],
  ["uploadChatBackground|/chat/backgrounds/:param/:param", "POST"],
  ["uploadAgentChatImage|/agent-assets/images", "POST"],
  ["uploadAgentReference|/agent-assets/reference-images", "POST"],
  ["createShortDramaSeries|/short-drama/series", "POST"],
  ["updateShortDramaSeries|/short-drama/series/:param", "PATCH"],
  ["uploadShortDramaEpisode|/short-drama/series/:param/episodes", "POST"],
  ["getMomentsFollowing|/moments/feed", "GET"],
  ["getMomentsWorld|/moments/world", "GET"],
  ["createMoment|/moments/create", "POST"],
  ["getUserMoments|/moments/user/:param", "GET"],
]);
const configuredSwiftContractAdditions = [
  {
    function: "setShortDramaLiked",
    route: "/short-drama/videos/:param/like",
    method: "POST",
    auth: true,
    idempotency: false,
    noCache: false,
    line: 4547,
  },
];
const expoWrapperMethods = new Map([
  ["activityMutation", "POST"],
  ["sensitiveActivityPost", "POST"],
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
      return part === referencePart || part === ":param" || referencePart === ":param";
    })
  );
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function hasSwiftIdempotencyEvidence(source) {
  if (/Idempotency-Key|idempotency_key/u.test(source)) return true;
  return [...source.matchAll(/idempotencyKey:\s*([^,\n)]+)/gu)].some(
    (match) => match[1]?.trim() !== "nil",
  );
}

function extractSwiftFunctions(source) {
  const result = [];
  const pattern =
    /(?:^|\n)\s*(?:(?:@[A-Za-z0-9_]+(?:\([^)]*\))?|private|fileprivate|internal|public|static|class|nonisolated)\s+)*func\s+([A-Za-z0-9_]+)\s*\(/gu;
  for (const match of source.matchAll(pattern)) {
    const signatureStart = match.index ?? 0;
    const bodyStart = source.indexOf("{", signatureStart + match[0].length);
    if (bodyStart < 0) continue;
    const bodyEnd = matchingBrace(source, bodyStart);
    if (bodyEnd < 0) continue;
    result.push({
      name: match[1],
      start: signatureStart,
      bodyStart,
      end: bodyEnd + 1,
      body: source.slice(bodyStart + 1, bodyEnd),
    });
  }
  return result;
}

function matchingBrace(source, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function matchingParenthesis(source, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function swiftMethod(body, routeIndex) {
  const explicit = [...body.matchAll(/request\.httpMethod\s*=\s*"([A-Z]+)"/gu)];
  if (explicit.length === 1) return explicit[0][1];

  const prefix = body.slice(Math.max(0, routeIndex - 900), routeIndex);
  const helperMatches = [
    ...prefix.matchAll(
      /\b(get|postJSON|putJSON|patchJSON|agentJSONRequest|activityJSONRequest|liveJSONRequest|shortDramaJSONRequest|gameJSONRequest)\s*\(/gu,
    ),
  ];
  const helper = helperMatches.at(-1);
  if (!helper) return explicit.at(-1)?.[1] ?? "UNKNOWN";
  const direct = directSwiftHelpers.get(helper[1]);
  if (direct) return direct;
  const helperOffset = Math.max(0, routeIndex - 900) + (helper.index ?? 0);
  const callWindow = body.slice(helperOffset, Math.min(body.length, routeIndex + 900));
  return callWindow.match(/\bmethod:\s*"([A-Z]+)"/u)?.[1] ?? "UNKNOWN";
}

function swiftContracts(source) {
  const contracts = [];
  for (const fn of extractSwiftFunctions(source)) {
    for (const match of fn.body.matchAll(/"(\/[^"\n]+)"/gu)) {
      const route = canonicalRoute(match[1]);
      if (excludedRoutes.has(route)) continue;
      const routeIndex = match.index ?? 0;
      const window = fn.body.slice(Math.max(0, routeIndex - 900), routeIndex + 1_200);
      contracts.push({
        function: fn.name,
        route,
        method:
          configuredSwiftMethodOverrides.get(`${fn.name}|${route}`) ??
          swiftMethod(fn.body, routeIndex),
        auth: !/\bauth:\s*false\b/u.test(window),
        idempotency: hasSwiftIdempotencyEvidence(window) || hasSwiftIdempotencyEvidence(fn.body),
        noCache:
          /reloadIgnoringLocalCacheData|no-cache|no-store/u.test(window) ||
          /reloadIgnoringLocalCacheData|no-cache|no-store/u.test(fn.body),
        line: lineNumber(source, fn.bodyStart + 1 + routeIndex),
      });
    }
  }
  return uniqueContracts([...contracts, ...configuredSwiftContractAdditions]);
}

function expoContracts() {
  const roots = ["api", "services", "providers", "components"]
    .map((name) => join(appRoot, "src", name))
    .filter((path) => statSync(path).isDirectory());
  const contracts = [];
  for (const path of roots.flatMap(walk)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/(["`](\/[^"`\n]+)["`])/gu)) {
      const route = canonicalRoute(match[2]);
      const routeIndex = match.index ?? 0;
      const call = containingExpoCall(source, routeIndex);
      if (!call) continue;
      const method =
        expoWrapperMethods.get(call.name) ??
        call.text.match(/\bmethod:\s*["']([A-Z]+)["']/u)?.[1] ??
        "GET";
      contracts.push({
        route,
        method,
        auth: !/\bauth:\s*false\b/u.test(call.text),
        idempotency: /Idempotency-Key|idempotencyKey|idempotency_key/u.test(call.text),
        noCache: /cache:\s*["']no-store["']|no-cache|no-store/u.test(call.text),
        file: relative(appRoot, path),
        line: lineNumber(source, routeIndex),
      });
    }
  }
  contracts.push(
    ...configuredExpoContracts.map((item) => ({
      ...item,
      auth: true,
      idempotency: false,
      noCache: item.noCache ?? false,
      line: 0,
    })),
  );
  return uniqueContracts(contracts);
}

function containingExpoCall(source, routeIndex) {
  const prefix = source.slice(Math.max(0, routeIndex - 1_200), routeIndex);
  const candidates = [
    ...prefix.matchAll(
      /\b(apiRequest|fetch|activityMutation|sensitiveActivityPost)\s*(?:<[^>]+>)?\s*\(/gu,
    ),
  ];
  for (const candidate of candidates.reverse()) {
    const absoluteStart = Math.max(0, routeIndex - 1_200) + (candidate.index ?? 0);
    const open = source.indexOf("(", absoluteStart);
    const end = matchingParenthesis(source, open);
    if (open >= 0 && end >= routeIndex) {
      return { name: candidate[1], text: source.slice(absoluteStart, end + 1) };
    }
  }
  return null;
}

function uniqueContracts(contracts) {
  const seen = new Set();
  return contracts.filter((item) => {
    const key = `${item.function ?? item.file}:${item.route}:${item.method}:${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const nativeSource = readFileSync(apiServicePath, "utf8");
const nativeContracts = swiftContracts(nativeSource);
const expo = expoContracts();
const rows = nativeContracts.map((native) => {
  const routeMatches = expo.filter((candidate) => routeShapeCovers(native.route, candidate.route));
  const methodMatches = routeMatches.filter((candidate) => candidate.method === native.method);
  const contractMatches = methodMatches.filter(
    (candidate) =>
      candidate.auth === native.auth &&
      candidate.idempotency === native.idempotency &&
      candidate.noCache === native.noCache,
  );
  const status =
    native.method === "UNKNOWN"
      ? "native_method_review"
      : contractMatches.length > 0
        ? "contract_candidate_present"
        : methodMatches.length > 0
          ? "contract_flag_review"
          : routeMatches.some((candidate) => candidate.method === "UNKNOWN")
            ? "expo_method_review"
            : "method_candidate_missing";
  return { ...native, status, expoCandidates: routeMatches };
});

const totals = {
  nativeContracts: rows.length,
  nativeMethodsKnown: rows.filter((row) => row.method !== "UNKNOWN").length,
  methodCandidatesPresent: rows.filter((row) =>
    row.expoCandidates.some((candidate) => candidate.method === row.method),
  ).length,
  contractCandidatesPresent: rows.filter((row) => row.status === "contract_candidate_present")
    .length,
  methodCandidatesMissing: rows.filter((row) => row.status === "method_candidate_missing").length,
  contractFlagReview: rows.filter((row) => row.status === "contract_flag_review").length,
  needsMethodReview: rows.filter((row) =>
    ["native_method_review", "expo_method_review"].includes(row.status),
  ).length,
};
const inventory = {
  generatedAt: new Date().toISOString(),
  nativeSource: relative(appRoot, apiServicePath),
  warning:
    "静态 method/auth/idempotency/cache 推断只用于发现候选差异；通过不证明 body、envelope、错误、分页、账号隔离、生命周期或状态回写完整。",
  totals,
  candidates: rows.filter((row) => row.status !== "contract_candidate_present"),
  contracts: rows,
};

const candidateRows = inventory.candidates.length
  ? inventory.candidates
      .map(
        (item) =>
          `| \`${item.route}\` | ${item.method} | \`${item.function}\` | ${item.status} | ${item.expoCandidates.map((candidate) => `${candidate.method} ${candidate.file}:${candidate.line}`).join("<br>") || "—"} |`,
      )
      .join("\n")
  : "| — | — | — | 无 method 候选差异 | — |";
const markdown = `# Swift→Expo API 合同第二层库存

> 生成时间：${inventory.generatedAt}  
> 生成脚本：\`scripts/generate-api-contract-inventory.mjs\`

本报告自动推断 route + HTTP method，并附带 auth、idempotency、no-cache 线索，只用于发现候选差异。通过不等于完整合同验收；body、响应 envelope/别名、错误、分页、账号隔离、并发/重试、生命周期和成功状态回写仍需域级测试。

## 汇总

| 项目 | 数量 |
|---|---:|
| Swift 调用合同 | ${totals.nativeContracts} |
| Swift method 已推断 | ${totals.nativeMethodsKnown} |
| Expo 同 route+method 候选存在 | ${totals.methodCandidatesPresent} |
| Expo method+auth+idempotency+no-cache 线索一致 | ${totals.contractCandidatesPresent} |
| method 候选缺口 | ${totals.methodCandidatesMissing} |
| auth/idempotency/no-cache 线索待判定 | ${totals.contractFlagReview} |
| 需人工判定 method | ${totals.needsMethodReview} |

## 候选差异/人工判定

| Native route | Native method | Swift function | 状态 | Expo 候选 |
|---|---|---|---|---|
${candidateRows}
`;

writeFileSync(
  outputJSON,
  await format(`${JSON.stringify(inventory, null, 2)}\n`, { parser: "json", printWidth: 100 }),
);
writeFileSync(outputMarkdown, await format(markdown, { parser: "markdown", printWidth: 100 }));
process.stdout.write(
  `API contract inventory: ${totals.methodCandidatesPresent}/${totals.nativeContracts} methods and ${totals.contractCandidatesPresent}/${totals.nativeContracts} contract flags present; ${totals.methodCandidatesMissing} method gaps, ${totals.contractFlagReview} flag reviews, ${totals.needsMethodReview} method reviews.\n`,
);
