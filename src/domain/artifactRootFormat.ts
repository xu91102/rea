/** Existing filename commitments take precedence over root fallback probes. */
export const namedArtifactRootFormatForPath = (
  path: string,
): "asar" | "plist" | "source-map" | "javascript" | undefined => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".asar")) return "asar";
  if (lower.endsWith(".plist")) return "plist";
  if (lower.endsWith(".map")) return "source-map";
  return /\.(?:m?js|cjs)$/u.test(lower) ? "javascript" : undefined;
};
