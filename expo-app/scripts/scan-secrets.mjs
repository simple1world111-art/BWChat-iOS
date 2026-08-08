#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const excludedDirectories = new Set([
  ".git",
  ".expo",
  ".gradle",
  ".kotlin",
  "DerivedData",
  "Pods",
  "build",
  "node_modules",
]);
const binaryExtensions = new Set([
  ".a",
  ".aar",
  ".app",
  ".avi",
  ".bin",
  ".car",
  ".dylib",
  ".gif",
  ".heic",
  ".ico",
  ".ipa",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".otf",
  ".pdf",
  ".png",
  ".so",
  ".ttf",
  ".wav",
  ".webp",
  ".xcarchive",
  ".zip",
]);
const forbiddenExtensions = new Set([
  ".jks",
  ".key",
  ".keystore",
  ".mobileprovision",
  ".p12",
  ".p8",
  ".pem",
]);
const forbiddenNames = new Set(["credentials.json", "service-account.json"]);
const privateKeyPattern = ["-----BEGIN", "(?:RSA |EC |OPENSSH )?PRIVATE", "KEY-----"].join(" ");
const googlePrivateKeyPattern = ['"private_key"\\s*:\\s*"-----BEGIN', "PRIVATE", "KEY-----"].join(
  " ",
);
const contentRules = [
  ["private-key-block", new RegExp(privateKeyPattern, "u")],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,}\b/u],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u],
  ["google-service-account-key", new RegExp(googlePrivateKeyPattern, "u")],
];
const protectedAssignment =
  /\b(EXPO_TOKEN|SENTRY_AUTH_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|AWS_SECRET_ACCESS_KEY|APPLE_API_KEY|ASC_API_KEY)["']?\s*[:=]\s*["']?([^\s"',}]+)/gu;
const findings = [];
let scannedFiles = 0;

await walk(repositoryRoot);

if (findings.length > 0) {
  for (const finding of findings) process.stderr.write(`${finding.path}: ${finding.rule}\n`);
  process.stderr.write(`Secret scan failed with ${findings.length} high-confidence finding(s).\n`);
  process.exit(1);
}
process.stdout.write(`Secret scan passed: ${scannedFiles} text files checked.\n`);

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name) || entry.name.startsWith("dist-")) continue;
      await walk(absolutePath);
      continue;
    }
    if (!entry.isFile()) continue;
    await inspectFile(absolutePath);
  }
}

async function inspectFile(absolutePath) {
  const relativePath = path.relative(repositoryRoot, absolutePath);
  const basename = path.basename(absolutePath);
  const extension = path.extname(basename).toLocaleLowerCase();
  if (basename.startsWith(".env") && basename !== ".env.example") {
    findings.push({ path: relativePath, rule: "environment file must not be committed" });
    return;
  }
  if (
    forbiddenExtensions.has(extension) ||
    forbiddenNames.has(basename.toLocaleLowerCase()) ||
    /^service-account.+\.json$/iu.test(basename)
  ) {
    findings.push({ path: relativePath, rule: "credential/key file must not be committed" });
    return;
  }
  if (binaryExtensions.has(extension)) return;
  const metadata = await stat(absolutePath);
  if (metadata.size > 2_000_000) return;
  const buffer = await readFile(absolutePath);
  if (buffer.includes(0)) return;
  const content = buffer.toString("utf8");
  scannedFiles += 1;
  for (const [rule, pattern] of contentRules) {
    if (pattern.test(content)) findings.push({ path: relativePath, rule });
  }
  for (const line of content.split(/\r?\n/u)) {
    if (line.trimStart().startsWith("#")) continue;
    protectedAssignment.lastIndex = 0;
    for (const match of line.matchAll(protectedAssignment)) {
      const value = match[2] ?? "";
      if (!isPlaceholder(value)) {
        findings.push({ path: relativePath, rule: `literal ${match[1]} assignment` });
      }
    }
  }
}

function isPlaceholder(value) {
  const normalized = value.toLocaleLowerCase();
  return (
    !normalized ||
    normalized.startsWith("$") ||
    normalized.startsWith("<") ||
    normalized.includes("secret") ||
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized.startsWith("your-")
  );
}
