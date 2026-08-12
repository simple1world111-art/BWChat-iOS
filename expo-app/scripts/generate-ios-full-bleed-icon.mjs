#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmStore = path.join(projectRoot, "node_modules/.pnpm");
const pngPackageDirectory = fs
  .readdirSync(pnpmStore)
  .find((entry) => /^pngjs@5\.0\.0(?:_|$)/u.test(entry));
assert(pngPackageDirectory, "The locked pngjs@5.0.0 package is required to generate the icon.");
const require = createRequire(
  path.join(pnpmStore, pngPackageDirectory, "node_modules/pngjs/package.json"),
);
const { PNG } = require("pngjs");
const sourcePath = path.join(projectRoot, "assets/images/bwchat/icon.png");
const outputPath = path.resolve(
  projectRoot,
  process.argv.slice(2).find((value) => value !== "--") ??
    "assets/images/bwchat/icon-ios-full-bleed.png",
);

const source = PNG.sync.read(fs.readFileSync(sourcePath));
assert.equal(source.width, 1024, "The source icon must be 1024px wide.");
assert.equal(source.height, 1024, "The source icon must be 1024px high.");

const pixelCount = source.width * source.height;
const cornerWhiteMask = new Uint8Array(pixelCount);
const queue = new Int32Array(pixelCount);
let queueStart = 0;
let queueEnd = 0;

function pixelOffset(x, y) {
  return (y * source.width + x) * 4;
}

function isCornerFillCandidate(x, y) {
  const offset = pixelOffset(x, y);
  const red = source.data[offset];
  const green = source.data[offset + 1];
  const blue = source.data[offset + 2];
  return red >= 230 && green >= 200 && blue >= 80;
}

function enqueueIfCornerWhite(x, y) {
  if (x < 0 || x >= source.width || y < 0 || y >= source.height) return;
  const index = y * source.width + x;
  if (cornerWhiteMask[index] || !isCornerFillCandidate(x, y)) return;
  cornerWhiteMask[index] = 1;
  queue[queueEnd++] = index;
}

enqueueIfCornerWhite(0, 0);
enqueueIfCornerWhite(source.width - 1, 0);
enqueueIfCornerWhite(0, source.height - 1);
enqueueIfCornerWhite(source.width - 1, source.height - 1);

while (queueStart < queueEnd) {
  const index = queue[queueStart++];
  const x = index % source.width;
  const y = Math.floor(index / source.width);
  enqueueIfCornerWhite(x - 1, y);
  enqueueIfCornerWhite(x + 1, y);
  enqueueIfCornerWhite(x, y - 1);
  enqueueIfCornerWhite(x, y + 1);
}

assert(queueEnd > 25_000, "Expected to find the four baked white icon corners.");
assert(queueEnd < 60_000, "The corner mask unexpectedly covers too much of the icon.");

function isCornerRegion(x, y) {
  const horizontalCorner = x < 256 || x >= source.width - 256;
  const verticalCorner = y < 256 || y >= source.height - 256;
  return horizontalCorner && verticalCorner;
}

function isYellowEdgePixel(x, y) {
  const offset = pixelOffset(x, y);
  return source.data[offset] >= 230 && source.data[offset + 1] >= 170;
}

for (let pass = 0; pass < 4; pass += 1) {
  const expandedMask = cornerWhiteMask.slice();
  for (let index = 0; index < pixelCount; index += 1) {
    if (!cornerWhiteMask[index]) continue;
    const x = index % source.width;
    const y = Math.floor(index / source.width);
    for (const [candidateX, candidateY] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (
        candidateX < 0 ||
        candidateX >= source.width ||
        candidateY < 0 ||
        candidateY >= source.height ||
        !isCornerRegion(candidateX, candidateY) ||
        !isYellowEdgePixel(candidateX, candidateY)
      ) {
        continue;
      }
      expandedMask[candidateY * source.width + candidateX] = 1;
    }
  }
  cornerWhiteMask.set(expandedMask);
}

const output = new PNG({ width: source.width, height: source.height, colorType: 6 });
source.data.copy(output.data);

let changedPixels = 0;
for (let index = 0; index < pixelCount; index += 1) {
  if (!cornerWhiteMask[index]) continue;
  const y = Math.floor(index / source.width);
  const outputOffset = index * 4;
  output.data[outputOffset] = 253;
  output.data[outputOffset + 1] = Math.round(229 - y / (source.height - 1));
  output.data[outputOffset + 2] = 12;
  output.data[outputOffset + 3] = 255;
  changedPixels += 1;
}

for (let x = 0; x < output.width; x += 1) {
  assert(!isOutputPale(x, 0), `Pale pixel remains on the top edge at x=${x}.`);
  assert(!isOutputPale(x, output.height - 1), `Pale pixel remains on the bottom edge at x=${x}.`);
}
for (let y = 0; y < output.height; y += 1) {
  assert(!isOutputPale(0, y), `Pale pixel remains on the left edge at y=${y}.`);
  assert(!isOutputPale(output.width - 1, y), `Pale pixel remains on the right edge at y=${y}.`);
}

function isOutputPale(x, y) {
  const offset = pixelOffset(x, y);
  return output.data[offset + 2] > 80;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, PNG.sync.write(output, { colorType: 2 }));
process.stdout.write(
  `${JSON.stringify(
    {
      source: path.relative(projectRoot, sourcePath),
      output: path.relative(projectRoot, outputPath),
      changedPixels,
      preservedPixels: pixelCount - changedPixels,
      edgeWhitePixels: 0,
    },
    null,
    2,
  )}\n`,
);
