import { flexBool, flexString, isRecord } from "@/api/normalizers";

export const appBridgeMethods = ["close", "openRoute", "getAppInfo", "setNavigationTitle"] as const;

export type AppBridgeMethod = (typeof appBridgeMethods)[number];

export interface WebViewPolicy {
  allowedDomains: string[];
  blockedDomains: string[];
  allowedBridgeMethods: AppBridgeMethod[];
  externalDomainsOpenInSafari: boolean;
  requireHTTPS: boolean;
  permissionPolicy?: Record<string, string> | undefined;
}

export const defaultWebViewPolicy: WebViewPolicy = {
  allowedDomains: ["id7.com", "playdot.games"],
  blockedDomains: [],
  allowedBridgeMethods: [...appBridgeMethods],
  externalDomainsOpenInSafari: true,
  requireHTTPS: true,
};

export function normalizeWebViewPolicy(value: unknown): WebViewPolicy {
  if (!isRecord(value)) return clonePolicy(defaultWebViewPolicy);
  const allowedDomains = stringArray(value.allowed_domains, value.allowedDomains);
  const blockedDomains = stringArray(value.blocked_domains, value.blockedDomains);
  const bridgeSource = firstArray(value.allowed_bridge_methods, value.allowedBridgeMethods);
  const allowedBridgeMethods = bridgeSource
    ? bridgeSource.filter(
        (item): item is AppBridgeMethod => typeof item === "string" && isAppBridgeMethod(item),
      )
    : [...appBridgeMethods];
  const permissionValue = isRecord(value.permission_policy)
    ? value.permission_policy
    : isRecord(value.permissionPolicy)
      ? value.permissionPolicy
      : undefined;
  const permissionPolicy = permissionValue
    ? Object.fromEntries(
        Object.entries(permissionValue).flatMap(([key, raw]) => {
          const normalized = flexString(raw);
          return normalized ? [[key, normalized]] : [];
        }),
      )
    : undefined;

  return {
    allowedDomains,
    blockedDomains,
    allowedBridgeMethods,
    externalDomainsOpenInSafari:
      flexBool(value.external_domains_open_in_safari, value.externalDomainsOpenInSafari) ?? true,
    requireHTTPS: flexBool(value.require_https, value.requireHTTPS) ?? true,
    ...(permissionPolicy && Object.keys(permissionPolicy).length > 0 ? { permissionPolicy } : {}),
  };
}

export function gameLaunchPolicy(policy: WebViewPolicy): WebViewPolicy {
  return policy.allowedDomains.some((domain) => domain.trim().toLowerCase() === "id7.com")
    ? clonePolicy(policy)
    : { ...clonePolicy(policy), allowedDomains: [...policy.allowedDomains, "id7.com"] };
}

export function policyAllowsURL(
  value: string | URL,
  policy: WebViewPolicy,
  options: { allowDevelopmentLocalhost?: boolean } = {},
): boolean {
  const url = parsedURL(value);
  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname) return false;
  const host = url.hostname.toLowerCase();
  if (policy.requireHTTPS && url.protocol !== "https:") {
    // The native DEBUG escape hatch returns immediately, before domain lists.
    if (options.allowDevelopmentLocalhost && ["localhost", "127.0.0.1"].includes(host)) return true;
    return false;
  }
  if (policy.blockedDomains.some((domain) => hostMatchesDomain(host, domain))) return false;
  return policy.allowedDomains.some((domain) => hostMatchesDomain(host, domain));
}

export function hostMatchesDomain(host: string, pattern: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  return (
    Boolean(normalizedPattern) &&
    (normalizedHost === normalizedPattern || normalizedHost.endsWith(`.${normalizedPattern}`))
  );
}

export function shouldOpenURLExternally(value: string | URL): boolean {
  const url = parsedURL(value);
  if (!url) return false;
  const protocol = url.protocol.replace(":", "").toLowerCase();
  if (["tel", "mailto", "sms", "facetime", "itms-apps", "itms-services"].includes(protocol)) {
    return true;
  }
  const host = url.hostname.toLowerCase();
  return hostMatchesDomain(host, "apps.apple.com") || hostMatchesDomain(host, "itunes.apple.com");
}

function stringArray(...values: unknown[]): string[] {
  const source = firstArray(...values);
  if (!Array.isArray(source)) return [];
  return source.flatMap((item) => {
    const value = flexString(item);
    return value ? [value] : [];
  });
}

function firstArray(...values: unknown[]): unknown[] | undefined {
  return values.find(Array.isArray) as unknown[] | undefined;
}

function isAppBridgeMethod(value: string): value is AppBridgeMethod {
  return (appBridgeMethods as readonly string[]).includes(value);
}

function parsedURL(value: string | URL): URL | undefined {
  if (value instanceof URL) return value;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function clonePolicy(policy: WebViewPolicy): WebViewPolicy {
  return {
    ...policy,
    allowedDomains: [...policy.allowedDomains],
    blockedDomains: [...policy.blockedDomains],
    allowedBridgeMethods: [...policy.allowedBridgeMethods],
    ...(policy.permissionPolicy ? { permissionPolicy: { ...policy.permissionPolicy } } : {}),
  };
}
