export function resolveMediaUrl(
  rawValue: string | null | undefined,
  apiBaseUrl: string,
): string | null {
  const value = rawValue?.trim();
  if (!value) return null;
  const apiUrl = new URL(apiBaseUrl);
  try {
    const absolute = new URL(value);
    if (absolute.protocol === "https:") {
      if (absolute.hostname === "52.193.78.191" && apiUrl.protocol === "https:") {
        absolute.host = apiUrl.host;
      }
      return absolute.toString();
    }
    if (absolute.protocol === "http:") {
      if (apiUrl.protocol !== "https:") return absolute.toString();
      const isConfiguredHost = absolute.hostname.toLowerCase() === apiUrl.hostname.toLowerCase();
      const isLegacyApiHost = absolute.hostname === "52.193.78.191";
      if (!isConfiguredHost && !isLegacyApiHost) return null;
      absolute.protocol = "https:";
      absolute.host = apiUrl.host;
      return absolute.toString();
    }
    if (["file:", "content:", "data:", "blob:"].includes(absolute.protocol)) {
      return absolute.toString();
    }
  } catch {
    // Continue with a server-relative media path.
  }

  if (value.startsWith("/api/")) {
    return new URL(value, apiUrl.origin).toString();
  }
  return `${apiBaseUrl.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}
