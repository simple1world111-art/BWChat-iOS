import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * EAS CLI resolves @expo/cli from the project root before running `expo export`.
 * pnpm's strict layout keeps that transitive dependency beside `expo`, so expose
 * it only for the duration of the synchronous EAS command and remove our link in
 * all success/failure paths.
 */
export function withResolvableExpoCli(projectRoot, callback) {
  const projectRequire = createRequire(path.join(projectRoot, "package.json"));
  if (canResolveProjectExpoCli(projectRequire)) return callback();

  const expoPackagePath = projectRequire.resolve("expo/package.json");
  const expoRequire = createRequire(expoPackagePath);
  const expoCliDirectory = path.dirname(expoRequire.resolve("@expo/cli/package.json"));
  const linkPath = path.join(projectRoot, "node_modules", "@expo", "cli");

  if (existsSync(linkPath)) {
    throw new Error(
      `@expo/cli exists at ${linkPath} but cannot be resolved from the project root.`,
    );
  }

  mkdirSync(path.dirname(linkPath), { recursive: true });
  symlinkSync(expoCliDirectory, linkPath, "dir");

  try {
    if (!canResolveProjectExpoCli(projectRequire)) {
      throw new Error("Unable to expose Expo CLI to EAS from the pnpm dependency layout.");
    }
    return callback();
  } finally {
    removeOwnedLink(linkPath, expoCliDirectory);
  }
}

function canResolveProjectExpoCli(projectRequire) {
  try {
    projectRequire.resolve("@expo/cli/package.json");
    return true;
  } catch {
    return false;
  }
}

function removeOwnedLink(linkPath, expectedTarget) {
  if (!existsSync(linkPath)) return;
  if (!lstatSync(linkPath).isSymbolicLink()) {
    throw new Error(`Refusing to remove non-symlink Expo CLI path: ${linkPath}`);
  }
  if (realpathSync(linkPath) !== realpathSync(expectedTarget)) {
    throw new Error(`Refusing to remove an Expo CLI link whose target changed: ${linkPath}`);
  }
  unlinkSync(linkPath);
}
