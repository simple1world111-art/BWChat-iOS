const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const projectRootPattern = __dirname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fromProjectRoot = (pathPattern) =>
  new RegExp(`^${projectRootPattern}[/\\\\]${pathPattern}`);
const defaultBlockList = config.resolver.blockList
  ? Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList]
  : [];

config.resolver.blockList = [
  ...defaultBlockList,
  fromProjectRoot("artifacts[/\\\\].*"),
  fromProjectRoot("ios[/\\\\]build[/\\\\].*"),
  fromProjectRoot("android[/\\\\](?:app[/\\\\])?build[/\\\\].*"),
  fromProjectRoot("dist(?:-[^/\\\\]+)?[/\\\\].*"),
  fromProjectRoot("\\.expo[/\\\\].*"),
];

module.exports = config;
