import type { DynamicRoute } from "@/services/remote-config/types";

export type DynamicJSONValue =
  string | number | boolean | null | DynamicJSONValue[] | { [key: string]: DynamicJSONValue };

export interface DynamicComponent {
  id: string;
  type: string;
  visible?: boolean | undefined;
  minAppVersion?: string | undefined;
  maxAppVersion?: string | undefined;
  props: Record<string, DynamicJSONValue>;
  action?: DynamicRoute | undefined;
  children?: DynamicComponent[] | undefined;
}

export interface DynamicScreen {
  screenId: string;
  schemaVersion?: number | undefined;
  configVersion?: string | undefined;
  titleKey?: string | undefined;
  title?: string | undefined;
  titleI18n?: Record<string, string> | undefined;
  refreshIntervalSeconds?: number | undefined;
  components: DynamicComponent[];
}

export function normalizeDynamicToken(value: string): string {
  return value.trim().replaceAll("-", "_").toLowerCase();
}

export function isDynamicScreenSupported(screen: DynamicScreen): boolean {
  return (screen.schemaVersion ?? 1) <= 1;
}

export function displayDynamicScreenTitle(
  screen: DynamicScreen,
  language: string,
  translate: (key: string) => string,
): string {
  return (
    localizedDynamicValue(screen.titleI18n, language) ??
    translatedValue(screen.titleKey, translate) ??
    nonblank(screen.title) ??
    screen.screenId
  );
}

export function dynamicString(value: DynamicJSONValue | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(Math.trunc(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  return undefined;
}

export function dynamicInteger(value: DynamicJSONValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^[-+]?\d+$/u.test(value)) return Number.parseInt(value, 10);
  return undefined;
}

export function dynamicArray(value: DynamicJSONValue | undefined): DynamicJSONValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function localizedDynamicProp(
  props: Record<string, DynamicJSONValue>,
  key: string,
  language: string,
): string | undefined {
  const value = props[key];
  if (isDynamicRecord(value)) {
    const localized = Object.fromEntries(
      Object.entries(value).flatMap(([entryKey, entryValue]) => {
        const text = dynamicString(entryValue);
        return text ? [[entryKey, text]] : [];
      }),
    );
    return localizedDynamicValue(localized, language);
  }
  const text = dynamicString(value);
  return text !== undefined && text.trim() ? text : undefined;
}

export function localizedDynamicValue(
  values: Record<string, string> | undefined,
  language: string,
): string | undefined {
  if (!values) return undefined;
  const normalized = language.replaceAll("_", "-");
  const base = normalized.split("-")[0] ?? "";
  for (const candidate of [language, normalized, base, "en", "zh-Hans"]) {
    const result = nonblank(values[candidate]);
    if (result) return result;
  }
  return undefined;
}

export function parseDynamicScreen(value: unknown): DynamicScreen | null {
  return parseDynamicScreenValue(value, true);
}

/** Decode the server's Swift Codable wire shape without accepting camelCase aliases. */
export function parseDynamicScreenWire(value: unknown): DynamicScreen | null {
  return parseDynamicScreenValue(value, false);
}

function parseDynamicScreenValue(
  value: unknown,
  allowStoredAliases: boolean,
): DynamicScreen | null {
  const raw = record(value);
  if (!raw || !Array.isArray(raw.components)) return null;
  const screenId = requiredStringField(
    raw,
    "screen_id",
    ...(allowStoredAliases ? ["screenId"] : []),
  );
  if (screenId === null) return null;
  const components: DynamicComponent[] = [];
  for (const item of raw.components) {
    const component = parseDynamicComponentValue(item, allowStoredAliases);
    if (!component) return null;
    components.push(component);
  }
  const screen: DynamicScreen = { screenId, components };
  if (
    !assignOptionalField(
      screen,
      "schemaVersion",
      raw,
      optionalInteger,
      "schema_version",
      ...(allowStoredAliases ? ["schemaVersion"] : []),
    )
  )
    return null;
  if (
    !assignOptionalField(
      screen,
      "configVersion",
      raw,
      optionalString,
      "config_version",
      ...(allowStoredAliases ? ["configVersion"] : []),
    )
  )
    return null;
  if (
    !assignOptionalField(
      screen,
      "titleKey",
      raw,
      optionalString,
      "title_key",
      ...(allowStoredAliases ? ["titleKey"] : []),
    )
  )
    return null;
  if (!assignOptionalField(screen, "title", raw, optionalString, "title")) return null;
  if (
    !assignOptionalField(
      screen,
      "titleI18n",
      raw,
      optionalLocalizedMap,
      "title_i18n",
      ...(allowStoredAliases ? ["titleI18n"] : []),
    )
  )
    return null;
  if (
    !assignOptionalField(
      screen,
      "refreshIntervalSeconds",
      raw,
      optionalInteger,
      "refresh_interval_seconds",
      ...(allowStoredAliases ? ["refreshIntervalSeconds"] : []),
    )
  )
    return null;
  return screen;
}

export function parseDynamicComponent(value: unknown): DynamicComponent | null {
  return parseDynamicComponentValue(value, true);
}

function parseDynamicComponentValue(
  value: unknown,
  allowStoredAliases: boolean,
): DynamicComponent | null {
  const raw = record(value);
  if (!raw) return null;
  const id = requiredStringField(raw, "id");
  const type = requiredStringField(raw, "type");
  const props = dynamicRecord(raw.props);
  if (id === null || type === null || props === undefined) return null;
  const component: DynamicComponent = {
    id,
    type,
    props,
  };
  if (!assignOptionalField(component, "visible", raw, optionalBoolean, "visible")) return null;
  if (
    !assignOptionalField(
      component,
      "minAppVersion",
      raw,
      optionalString,
      "min_app_version",
      ...(allowStoredAliases ? ["minAppVersion"] : []),
    )
  )
    return null;
  if (
    !assignOptionalField(
      component,
      "maxAppVersion",
      raw,
      optionalString,
      "max_app_version",
      ...(allowStoredAliases ? ["maxAppVersion"] : []),
    )
  )
    return null;
  const action = optionalDynamicRoute(field(raw, "action").value, allowStoredAliases);
  if (!action.ok) return null;
  assign(component, "action", action.value);
  const childField = field(raw, "children");
  if (childField.present && childField.value !== null) {
    if (!Array.isArray(childField.value)) return null;
    const children: DynamicComponent[] = [];
    for (const item of childField.value) {
      const child = parseDynamicComponentValue(item, allowStoredAliases);
      if (!child) return null;
      children.push(child);
    }
    component.children = children;
  }
  return component;
}

function optionalDynamicRoute(value: unknown, allowStoredAliases: boolean): Decoded<DynamicRoute> {
  if (value === undefined || value === null) return decoded(undefined);
  const raw = record(value);
  if (!raw) return invalid();
  const route: DynamicRoute = {};
  if (!assignOptionalField(route, "type", raw, optionalString, "type")) return invalid();
  if (!assignOptionalField(route, "name", raw, optionalString, "name")) return invalid();
  if (!assignOptionalField(route, "url", raw, optionalString, "url")) return invalid();
  if (
    !assignOptionalField(
      route,
      "screenId",
      raw,
      optionalString,
      "screen_id",
      ...(allowStoredAliases ? ["screenId"] : []),
    )
  )
    return invalid();
  if (
    !assignOptionalField(
      route,
      "titleKey",
      raw,
      optionalString,
      "title_key",
      ...(allowStoredAliases ? ["titleKey"] : []),
    )
  )
    return invalid();
  if (!assignOptionalField(route, "title", raw, optionalString, "title")) return invalid();
  if (
    !assignOptionalField(
      route,
      "titleI18n",
      raw,
      optionalLocalizedMap,
      "title_i18n",
      ...(allowStoredAliases ? ["titleI18n"] : []),
    )
  )
    return invalid();
  if (
    !assignOptionalField(
      route,
      "messageKey",
      raw,
      optionalString,
      "message_key",
      ...(allowStoredAliases ? ["messageKey"] : []),
    )
  )
    return invalid();
  if (!assignOptionalField(route, "message", raw, optionalString, "message")) return invalid();
  if (
    !assignOptionalField(
      route,
      "messageI18n",
      raw,
      optionalLocalizedMap,
      "message_i18n",
      ...(allowStoredAliases ? ["messageI18n"] : []),
    )
  )
    return invalid();
  const paramsField = field(raw, "params");
  if (paramsField.present && paramsField.value !== null) {
    const params = dynamicRecord(paramsField.value);
    if (!params) return invalid();
    route.params = params;
  }
  return decoded(route);
}

function isDynamicRecord(
  value: DynamicJSONValue | undefined,
): value is Record<string, DynamicJSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dynamicRecord(value: unknown): Record<string, DynamicJSONValue> | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const result: Record<string, DynamicJSONValue> = {};
  for (const [key, item] of Object.entries(candidate)) {
    if (!isDynamicValue(item)) return undefined;
    result[key] = item;
  }
  return result;
}

function isDynamicValue(value: unknown): value is DynamicJSONValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isDynamicValue);
  return (
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every(isDynamicValue)
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonblank(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function translatedValue(
  key: string | undefined,
  translate: (key: string) => string,
): string | undefined {
  const normalized = nonblank(key);
  if (!normalized) return undefined;
  const translated = translate(normalized);
  return translated !== normalized ? translated : undefined;
}

function assign<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

type Decoded<T> = { ok: true; value: T | undefined } | { ok: false };

function decoded<T>(value: T | undefined): Decoded<T> {
  return { ok: true, value };
}

function invalid<T>(): Decoded<T> {
  return { ok: false };
}

function field(
  raw: Record<string, unknown>,
  ...keys: string[]
): { present: boolean; value: unknown } {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) return { present: true, value: raw[key] };
  }
  return { present: false, value: undefined };
}

function requiredStringField(raw: Record<string, unknown>, ...keys: string[]): string | null {
  const candidate = field(raw, ...keys);
  return candidate.present && typeof candidate.value === "string" ? candidate.value : null;
}

function optionalString(value: unknown): Decoded<string> {
  return value === undefined || value === null
    ? decoded(undefined)
    : typeof value === "string"
      ? decoded(value)
      : invalid();
}

function optionalInteger(value: unknown): Decoded<number> {
  return value === undefined || value === null
    ? decoded(undefined)
    : typeof value === "number" && Number.isSafeInteger(value)
      ? decoded(value)
      : invalid();
}

function optionalBoolean(value: unknown): Decoded<boolean> {
  return value === undefined || value === null
    ? decoded(undefined)
    : typeof value === "boolean"
      ? decoded(value)
      : invalid();
}

function optionalLocalizedMap(value: unknown): Decoded<Record<string, string>> {
  if (value === undefined || value === null) return decoded(undefined);
  const raw = record(value);
  if (!raw || Object.values(raw).some((item) => typeof item !== "string")) return invalid();
  return decoded(raw as Record<string, string>);
}

function assignOptionalField<T extends object, K extends keyof T>(
  target: T,
  key: K,
  raw: Record<string, unknown>,
  decode: (value: unknown) => Decoded<NonNullable<T[K]>>,
  ...keys: string[]
): boolean {
  const candidate = field(raw, ...keys);
  const result = decode(candidate.value);
  if (!result.ok) return false;
  assign(target, key, result.value as T[K] | undefined);
  return true;
}
