export function resolveMediaUrl(rawValue: string | null | undefined, apiBaseUrl: string): string | null {
  const value = rawValue?.trim();
  if (!value) return null;
  try {
    const absolute = new URL(value);
    if (absolute.protocol === "http:" || absolute.protocol === "https:") return absolute.toString();
    if (["file:", "content:", "data:", "blob:"].includes(absolute.protocol)) {
      return absolute.toString();
    }
  } catch {
    // Continue with a server-relative media path.
  }

  const apiUrl = new URL(apiBaseUrl);
  if (value.startsWith("/api/")) {
    return new URL(value, apiUrl.origin).toString();
  }
  return `${apiBaseUrl.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}
