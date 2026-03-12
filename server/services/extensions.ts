import { db, DEFAULT_SETTINGS } from "../db.js";

type UnknownRecord = Record<string, unknown>;

export interface CustomInspectorFieldOption {
  value: string;
  label: string;
}

export interface CustomInspectorField {
  id: string;
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "range" | "toggle";
  section: "scene" | "context";
  helpText?: string;
  placeholder?: string;
  options?: CustomInspectorFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  order: number;
  defaultValue?: string;
  visibleInPureChat: boolean;
}

export interface CustomEndpointAdapterEndpoint {
  enabled: boolean;
  method: "GET" | "POST" | "PATCH";
  path: string;
  resultPath?: string;
  bodyTemplate?: unknown;
  headersTemplate?: Record<string, string>;
}

export interface CustomEndpointAdapter {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  authMode: "none" | "bearer" | "header";
  authHeader: string;
  models?: CustomEndpointAdapterEndpoint;
  voices?: CustomEndpointAdapterEndpoint;
  test?: CustomEndpointAdapterEndpoint;
  chat: CustomEndpointAdapterEndpoint;
  tts?: CustomEndpointAdapterEndpoint;
}

function readSettingsPayload(): UnknownRecord {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.payload) as UnknownRecord;
  } catch {
    return {};
  }
}

function writeSettingsPayload(payload: UnknownRecord) {
  db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(payload));
}

function normalizeId(raw: unknown, fallback: string) {
  return String(raw || fallback).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function normalizeMethod(raw: unknown): "GET" | "POST" | "PATCH" {
  const method = String(raw || "POST").trim().toUpperCase();
  return method === "GET" || method === "PATCH" ? method : "POST";
}

function normalizeHeadersTemplate(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as UnknownRecord)) {
    const header = String(key || "").trim();
    const headerValue = String(value || "").trim();
    if (!header || !headerValue) continue;
    out[header.slice(0, 100)] = headerValue.slice(0, 500);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeEndpoint(raw: unknown, fallbackMethod: "GET" | "POST" = "POST"): CustomEndpointAdapterEndpoint | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as UnknownRecord;
  const path = String(row.path || "").trim();
  if (!path) return undefined;
  return {
    enabled: row.enabled !== false,
    method: normalizeMethod(row.method || fallbackMethod),
    path: path.slice(0, 500),
    resultPath: String(row.resultPath || "").trim().slice(0, 300) || undefined,
    bodyTemplate: row.bodyTemplate,
    headersTemplate: normalizeHeadersTemplate(row.headersTemplate)
  };
}

export function normalizeCustomInspectorFields(raw: unknown): CustomInspectorField[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SETTINGS.customInspectorFields];
  const out: CustomInspectorField[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as UnknownRecord;
    const id = normalizeId(row.id, `field-${index + 1}`);
    const key = normalizeId(row.key, id);
    const type = String(row.type || "text").trim() as CustomInspectorField["type"];
    const section = String(row.section || "scene").trim() as CustomInspectorField["section"];
    if (seen.has(id) || !["text", "textarea", "select", "range", "toggle"].includes(type) || !["scene", "context"].includes(section)) continue;
    seen.add(id);
    const options = Array.isArray(row.options)
      ? row.options
        .map((entry, optionIndex) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const option = entry as UnknownRecord;
          const value = String(option.value || "").trim();
          const label = String(option.label || value || `Option ${optionIndex + 1}`).trim();
          if (!value) return null;
          return { value: value.slice(0, 200), label: label.slice(0, 200) };
        })
        .filter((entry): entry is CustomInspectorFieldOption => entry !== null)
      : [];
    const min = Number(row.min);
    const max = Number(row.max);
    const step = Number(row.step);
    const rows = Number(row.rows);
    out.push({
      id,
      key,
      label: String(row.label || key).trim().slice(0, 120) || key,
      type,
      section,
      helpText: String(row.helpText || "").trim().slice(0, 300) || undefined,
      placeholder: String(row.placeholder || "").trim().slice(0, 200) || undefined,
      options: options.length > 0 ? options : undefined,
      min: Number.isFinite(min) ? min : undefined,
      max: Number.isFinite(max) ? max : undefined,
      step: Number.isFinite(step) ? step : undefined,
      rows: Number.isFinite(rows) ? Math.max(2, Math.min(16, Math.floor(rows))) : undefined,
      order: Number.isFinite(Number(row.order)) ? Math.max(1, Math.floor(Number(row.order))) : index + 1,
      defaultValue: String(row.defaultValue || "").slice(0, 500) || undefined,
      visibleInPureChat: row.visibleInPureChat === true
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

export function normalizeCustomEndpointAdapters(raw: unknown): CustomEndpointAdapter[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SETTINGS.customEndpointAdapters];
  const out: CustomEndpointAdapter[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as UnknownRecord;
    const id = normalizeId(row.id, `adapter-${index + 1}`);
    if (seen.has(id)) continue;
    const chat = normalizeEndpoint(row.chat);
    if (!chat) continue;
    seen.add(id);
    const authMode = String(row.authMode || "bearer").trim();
    out.push({
      id,
      name: String(row.name || id).trim().slice(0, 120) || id,
      description: String(row.description || "").trim().slice(0, 300),
      enabled: row.enabled !== false,
      authMode: authMode === "none" || authMode === "header" ? authMode : "bearer",
      authHeader: String(row.authHeader || "X-API-Key").trim().slice(0, 100) || "X-API-Key",
      models: normalizeEndpoint(row.models, "GET"),
      voices: normalizeEndpoint(row.voices, "GET"),
      test: normalizeEndpoint(row.test, "GET"),
      chat,
      tts: normalizeEndpoint(row.tts, "POST")
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getExtensionsState() {
  const payload = readSettingsPayload();
  return {
    customInspectorFields: normalizeCustomInspectorFields(payload.customInspectorFields),
    customEndpointAdapters: normalizeCustomEndpointAdapters(payload.customEndpointAdapters)
  };
}

export function saveCustomInspectorFields(fields: unknown) {
  const payload = readSettingsPayload();
  const normalized = normalizeCustomInspectorFields(fields);
  payload.customInspectorFields = normalized;
  writeSettingsPayload(payload);
  return normalized;
}

export function saveCustomEndpointAdapters(adapters: unknown) {
  const payload = readSettingsPayload();
  const normalized = normalizeCustomEndpointAdapters(adapters);
  payload.customEndpointAdapters = normalized;
  writeSettingsPayload(payload);
  return normalized;
}

export function getCustomEndpointAdapter(adapterId: string) {
  const id = String(adapterId || "").trim();
  if (!id) return null;
  return getExtensionsState().customEndpointAdapters.find((adapter) => adapter.id === id && adapter.enabled) || null;
}
