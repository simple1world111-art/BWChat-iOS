export const agentComposerImagePolicy = Object.freeze({
  jpegQuality: 0.9,
  uploadMaximumBytes: 2_000_000,
  uploadMaximumDimension: 1_200,
  uploadDimensions: [1_200, 900, 675, 640] as const,
  uploadQualities: [0.7, 0.65, 0.55, 0.45, 0.35] as const,
});
