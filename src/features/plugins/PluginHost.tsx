import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../shared/api";
import { isTrustedPluginFrameMessage, normalizePluginApiRequest } from "./security";
import { buildPluginInlineRequest } from "./utils";
import type {
  PluginActionContribution,
  PluginActionLocation,
  PluginCatalog,
  PluginDescriptor,
  PluginSlotContribution,
  PluginSlotId,
  PluginTabContribution
} from "../../shared/types/contracts";

interface PluginActionRequest {
  plugin: PluginDescriptor;
  action: PluginActionContribution;
  payload?: Record<string, unknown>;
}

interface PluginActionStatus {
  tone: "success" | "error";
  text: string;
}

const PLUGIN_DEV_AUTO_REFRESH_STORAGE_KEY = "vellium:plugin-dev-auto-refresh";

interface PluginRuntimeValue {
  catalog: PluginCatalog | null;
  catalogRevision: number;
  plugins: PluginDescriptor[];
  loading: boolean;
  error: string;
  refresh: (options?: { force?: boolean; silent?: boolean }) => Promise<void>;
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  getSlotContributions: (slotId: PluginSlotId) => Array<{ plugin: PluginDescriptor; slot: PluginSlotContribution }>;
  getActionContributions: (location: PluginActionLocation) => Array<{ plugin: PluginDescriptor; action: PluginActionContribution }>;
  runPluginAction: (plugin: PluginDescriptor, action: PluginActionContribution, payload?: Record<string, unknown>) => Promise<void>;
  closePluginAction: () => void;
  activeActionRequest: PluginActionRequest | null;
  actionStatus: PluginActionStatus | null;
  pluginTabs: Array<{ plugin: PluginDescriptor; tab: PluginTabContribution }>;
  pendingPluginStates: Record<string, boolean>;
  locale: string;
  activeTab: string;
}

const PluginRuntimeContext = createContext<PluginRuntimeValue | null>(null);

function getThemeMode(): "dark" | "light" {
  return document.documentElement.classList.contains("theme-light") ? "light" : "dark";
}

function getThemeVariables(): Record<string, string> {
  const styles = window.getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (let index = 0; index < styles.length; index += 1) {
    const key = styles.item(index);
    if (!key || !key.startsWith("--")) continue;
    const value = styles.getPropertyValue(key).trim();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

async function performPluginApiRequest(methodRaw: unknown, pathRaw: unknown, body: unknown) {
  return performPluginApiRequestFor(null, methodRaw, pathRaw, body);
}

function hasPluginPermission(plugin: PluginDescriptor | null, permission: string) {
  if (!plugin) return true;
  return Array.isArray(plugin.permissions) ? plugin.permissions.includes(permission) : true;
}

async function performPluginApiRequestFor(plugin: PluginDescriptor | null, methodRaw: unknown, pathRaw: unknown, body: unknown) {
  const method = String(methodRaw || "GET").trim().toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new Error(`Unsupported plugin API method: ${method}`);
  }
  const { fetchPath, pathname } = normalizePluginApiRequest(pathRaw, window.location.origin);
  if (/^\/api\/account(?:$|[/?#])/.test(pathname)) {
    throw new Error("Plugins cannot access account routes");
  }
  if (/^\/api\/settings(?:$|[/?#])/.test(pathname)) {
    throw new Error("Plugins cannot access global settings directly");
  }
  const pluginSettingsMatch = pathname.match(/^\/api\/plugins\/([^/]+)\/settings(?:$|[/?#])/);
  if (plugin && pluginSettingsMatch) {
    const targetPluginId = decodeURIComponent(pluginSettingsMatch[1] || "");
    if (targetPluginId !== plugin.id) {
      throw new Error("Plugins can only access their own settings");
    }
    if (method === "GET" && !hasPluginPermission(plugin, "pluginSettings.read")) {
      throw new Error("Plugin is missing pluginSettings.read permission");
    }
    if (method !== "GET" && !hasPluginPermission(plugin, "pluginSettings.write")) {
      throw new Error("Plugin is missing pluginSettings.write permission");
    }
  } else if (/^\/api\/plugins(?:$|[/?#])/.test(pathname)) {
    throw new Error("Plugins cannot access plugin management routes");
  } else if (plugin) {
    const permission = method === "GET" ? "api.read" : "api.write";
    if (!hasPluginPermission(plugin, permission)) {
      throw new Error(`Plugin is missing ${permission} permission`);
    }
  }
  const response = await fetch(fetchPath, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
    cache: "no-store"
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text();
  if (!response.ok) {
    const message = payload && typeof payload === "object" && !Array.isArray(payload) && "error" in payload
      ? String((payload as { error?: unknown }).error || "Plugin API request failed")
      : `Plugin API request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function postMessageToFrame(frame: HTMLIFrameElement | null, payload: Record<string, unknown>) {
  // Opaque sandboxed plugin frames cannot be targeted by this page's origin string.
  frame?.contentWindow?.postMessage({ __velliumHost: true, ...payload }, "*");
}

function readPluginDevAutoRefreshPreference(): boolean {
  try {
    return window.localStorage.getItem(PLUGIN_DEV_AUTO_REFRESH_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPluginDevAutoRefreshEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(PLUGIN_DEV_AUTO_REFRESH_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(new CustomEvent("plugin-dev-autorefresh-change", { detail: enabled }));
}

export function isPluginDevAutoRefreshEnabled() {
  return readPluginDevAutoRefreshPreference();
}

export function PluginProvider({ locale, activeTab, children }: { locale: string; activeTab: string; children: ReactNode }) {
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeActionRequest, setActiveActionRequest] = useState<PluginActionRequest | null>(null);
  const [actionStatus, setActionStatus] = useState<PluginActionStatus | null>(null);
  const [devAutoRefresh, setDevAutoRefresh] = useState<boolean>(readPluginDevAutoRefreshPreference());
  const [pendingPluginStates, setPendingPluginStates] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);
  const inFlightRefreshRef = useRef<Promise<void> | null>(null);
  const queuedRefreshRef = useRef<{ force: boolean; silent: boolean } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runRefresh = useCallback(async (initial: { force: boolean; silent: boolean }) => {
    let nextOptions: { force: boolean; silent: boolean } | null = initial;
    while (nextOptions) {
      const current = nextOptions;
      nextOptions = null;
      if (!current.silent && mountedRef.current) {
        setLoading(true);
        setError("");
      }
      try {
        const next = current.force ? await api.pluginsReload() : await api.pluginsList();
        if (mountedRef.current) {
          setCatalog({
            ...next,
            plugins: next.plugins.map((plugin) => (
              Object.prototype.hasOwnProperty.call(pendingPluginStates, plugin.id)
                ? { ...plugin, enabled: pendingPluginStates[plugin.id] }
                : plugin
            ))
          });
          setCatalogRevision((value) => value + 1);
          if (!current.silent) setError("");
        }
      } catch (err) {
        if (!current.silent && mountedRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setCatalog(null);
        }
      } finally {
        if (!current.silent && mountedRef.current) {
          setLoading(false);
        }
      }
      if (queuedRefreshRef.current) {
        nextOptions = queuedRefreshRef.current;
        queuedRefreshRef.current = null;
      }
    }
  }, [pendingPluginStates]);

  const refresh = useCallback((options?: { force?: boolean; silent?: boolean }) => {
    const normalized = {
      force: options?.force === true,
      silent: options?.silent === true
    };
    if (inFlightRefreshRef.current) {
      const queued = queuedRefreshRef.current;
      queuedRefreshRef.current = {
        force: normalized.force || queued?.force === true,
        silent: normalized.silent && queued?.silent !== false
      };
      return inFlightRefreshRef.current;
    }
    const promise = runRefresh(normalized).finally(() => {
      inFlightRefreshRef.current = null;
    });
    inFlightRefreshRef.current = promise;
    return promise;
  }, [runRefresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onPreferenceChange = (event: Event) => {
      setDevAutoRefresh(Boolean((event as CustomEvent<boolean>).detail));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PLUGIN_DEV_AUTO_REFRESH_STORAGE_KEY) return;
      setDevAutoRefresh(readPluginDevAutoRefreshPreference());
    };
    window.addEventListener("plugin-dev-autorefresh-change", onPreferenceChange as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("plugin-dev-autorefresh-change", onPreferenceChange as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!devAutoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh({ silent: true });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [devAutoRefresh, refresh]);

  useEffect(() => {
    if (!activeActionRequest || !catalog) return;
    const plugin = catalog.plugins.find((item) => item.id === activeActionRequest.plugin.id && item.enabled);
    const action = plugin?.actions.find((item) => item.id === activeActionRequest.action.id);
    if (!plugin || !action) {
      setActiveActionRequest(null);
    }
  }, [activeActionRequest, catalog]);

  useEffect(() => {
    if (!actionStatus) return;
    const timer = window.setTimeout(() => setActionStatus(null), 2400);
    return () => window.clearTimeout(timer);
  }, [actionStatus]);

  const setPluginEnabled = useCallback(async (pluginId: string, enabled: boolean) => {
    setPendingPluginStates((prev) => ({ ...prev, [pluginId]: enabled }));
    setCatalog((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        plugins: prev.plugins.map((plugin) => (
          plugin.id === pluginId
            ? { ...plugin, enabled }
            : plugin
        ))
      };
    });
    setCatalogRevision((value) => value + 1);
    if (!enabled) {
      setActiveActionRequest((current) => current?.plugin.id === pluginId ? null : current);
    }
    try {
      await api.pluginSetState(pluginId, enabled);
      try {
        await refresh({ force: true });
      } catch {
        // Keep the optimistic UI state if the follow-up catalog refresh fails.
      }
      if (mountedRef.current) {
        setPendingPluginStates((prev) => {
          const next = { ...prev };
          delete next[pluginId];
          return next;
        });
      }
    } catch (error) {
      if (mountedRef.current) {
        setPendingPluginStates((prev) => {
          const next = { ...prev };
          delete next[pluginId];
          return next;
        });
      }
      await refresh({ force: true, silent: true });
      throw error;
    }
  }, [refresh]);

  const plugins = catalog?.plugins || [];

  const pluginTabs = useMemo(() => {
    return plugins
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) => plugin.tabs.map((tab) => ({ plugin, tab })))
      .sort((a, b) => a.tab.order - b.tab.order || a.plugin.name.localeCompare(b.plugin.name));
  }, [plugins]);

  const getSlotContributions = useCallback((slotId: PluginSlotId) => {
    return plugins
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) => plugin.slots.filter((slot) => slot.slot === slotId).map((slot) => ({ plugin, slot })))
      .sort((a, b) => a.slot.order - b.slot.order || a.plugin.name.localeCompare(b.plugin.name));
  }, [plugins]);

  const getActionContributions = useCallback((location: PluginActionLocation) => {
    return plugins
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) => plugin.actions.filter((action) => action.location === location).map((action) => ({ plugin, action })))
      .sort((a, b) => a.action.order - b.action.order || a.plugin.name.localeCompare(b.plugin.name));
  }, [plugins]);

  const runPluginAction = useCallback(async (plugin: PluginDescriptor, action: PluginActionContribution, payload?: Record<string, unknown>) => {
    if (action.mode === "inline" && action.request) {
      if (action.confirmText && !window.confirm(action.confirmText)) return;
      try {
        const request = buildPluginInlineRequest(plugin, action, activeTab, locale, payload);
        if (!request) throw new Error("Invalid inline action request");
        await performPluginApiRequestFor(
          plugin,
          request.method,
          request.path,
          request.body
        );
        if (action.reloadPlugins) {
          await refresh({ force: true, silent: true });
        }
        setActionStatus({
          tone: "success",
          text: action.successMessage || `${plugin.name}: ${action.label}`
        });
      } catch (error) {
        setActionStatus({
          tone: "error",
          text: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }
    setActiveActionRequest({ plugin, action, payload });
  }, [activeTab, locale, refresh]);

  const closePluginAction = useCallback(() => {
    setActiveActionRequest(null);
  }, []);

  const value = useMemo<PluginRuntimeValue>(() => ({
    catalog,
    catalogRevision,
    plugins,
    loading,
    error,
    refresh,
    setPluginEnabled,
    getSlotContributions,
    getActionContributions,
    runPluginAction,
    closePluginAction,
    activeActionRequest,
    actionStatus,
    pluginTabs,
    pendingPluginStates,
    locale,
    activeTab
  }), [catalog, catalogRevision, plugins, loading, error, refresh, setPluginEnabled, getSlotContributions, getActionContributions, runPluginAction, closePluginAction, activeActionRequest, actionStatus, pluginTabs, pendingPluginStates, locale, activeTab]);

  return <PluginRuntimeContext.Provider value={value}>{children}</PluginRuntimeContext.Provider>;
}

export function usePlugins() {
  const value = useContext(PluginRuntimeContext);
  if (!value) throw new Error("usePlugins must be used inside PluginProvider");
  return value;
}

export function PluginFrame({
  plugin,
  url,
  title,
  activeTab,
  locale,
  defaultHeight,
  contextPayload,
  instanceKey,
  className,
  chrome = false
}: {
  plugin: PluginDescriptor;
  url: string;
  title?: string;
  activeTab: string;
  locale: string;
  defaultHeight: number;
  contextPayload?: Record<string, unknown>;
  instanceKey?: string;
  className?: string;
  chrome?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyTimeoutRef = useRef<number | null>(null);
  const frameId = useMemo(() => `plugin-frame:${plugin.id}:${instanceKey || "default"}`, [plugin.id, instanceKey]);
  const [height, setHeight] = useState(defaultHeight);
  const [themeMode, setThemeMode] = useState<"dark" | "light">(getThemeMode());
  const [themeVariables, setThemeVariables] = useState<Record<string, string>>(() => getThemeVariables());
  const [frameStatus, setFrameStatus] = useState<"loading" | "ready" | "error">("loading");
  const [frameError, setFrameError] = useState("");

  const sendContext = useCallback((requestId?: string) => {
    postMessageToFrame(iframeRef.current, {
      type: "context",
      requestId,
      context: {
        frameId,
        pluginId: plugin.id,
        locale,
        theme: themeMode,
        themeVariables,
        activeTab,
        grantedPermissions: plugin.grantedPermissions,
        payload: contextPayload
      }
    });
  }, [frameId, plugin.id, plugin.grantedPermissions, locale, themeMode, themeVariables, activeTab, contextPayload]);

  const armReadyTimeout = useCallback(() => {
    if (readyTimeoutRef.current) window.clearTimeout(readyTimeoutRef.current);
    readyTimeoutRef.current = window.setTimeout(() => {
      setFrameStatus((current) => {
        if (current === "ready") return current;
        setFrameError("Plugin frame did not finish initialization");
        return "error";
      });
    }, 5000);
  }, []);

  useEffect(() => {
    const onThemeChange = () => {
      setThemeMode(getThemeMode());
      setThemeVariables(getThemeVariables());
    };
    window.addEventListener("theme-change", onThemeChange);
    return () => window.removeEventListener("theme-change", onThemeChange);
  }, []);

  const frameUrl = useMemo(() => {
    const next = new URL(url, window.location.origin);
    next.searchParams.set("pluginId", plugin.id);
    next.searchParams.set("frameId", frameId);
    next.searchParams.set("hostTheme", themeMode);
    next.searchParams.set("hostLocale", locale);
    if (instanceKey) next.searchParams.set("instanceKey", instanceKey);
    return next.toString();
  }, [url, plugin.id, frameId, locale, themeMode, instanceKey]);

  useEffect(() => {
    setHeight(defaultHeight);
  }, [defaultHeight, url]);

  useEffect(() => {
    setFrameStatus("loading");
    setFrameError("");
    armReadyTimeout();
    return () => {
      if (readyTimeoutRef.current) {
        window.clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
    };
  }, [plugin.id, instanceKey, armReadyTimeout]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (!isTrustedPluginFrameMessage(event, iframeRef.current?.contentWindow || null, window.location.origin, plugin.id, frameId)) {
        return;
      }
      const msg = event.data as Record<string, unknown>;
      const type = String(msg.type || "");
      const requestId = msg.requestId ? String(msg.requestId) : undefined;
      if (type === "ready" || type === "get-context") {
        if (readyTimeoutRef.current) {
          window.clearTimeout(readyTimeoutRef.current);
          readyTimeoutRef.current = null;
        }
        setFrameStatus("ready");
        setFrameError("");
        sendContext(requestId);
        return;
      }
      if (type === "resize") {
        if (!hasPluginPermission(plugin, "host.resize")) return;
        const next = Number(msg.height);
        if (Number.isFinite(next)) {
          setHeight(Math.max(120, Math.min(1600, Math.floor(next))));
        }
        return;
      }
      if (type === "api-request") {
        try {
          const data = await performPluginApiRequestFor(plugin, msg.method, msg.path, msg.body);
          postMessageToFrame(iframeRef.current, {
            type: "api-response",
            requestId,
            ok: true,
            data
          });
        } catch (error) {
          postMessageToFrame(iframeRef.current, {
            type: "api-response",
            requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [plugin.id, frameId, locale, themeMode, themeVariables, activeTab, contextPayload, sendContext]);

  useEffect(() => {
    sendContext();
  }, [sendContext]);

  const frame = (
    <div className="plugin-frame-shell">
      <iframe
        ref={iframeRef}
        src={frameUrl}
        title={title || plugin.name}
        sandbox="allow-scripts allow-forms allow-downloads"
        className={className || "plugin-frame"}
        style={{ height }}
        onLoad={() => {
          setFrameStatus("loading");
          setFrameError("");
          armReadyTimeout();
          sendContext();
        }}
      />
      {frameStatus !== "ready" ? (
        <div className="plugin-frame-status">
          <div className="plugin-frame-status-card">
            <div className="plugin-frame-status-title">
              {frameStatus === "error" ? "Plugin failed to initialize" : "Initializing plugin"}
            </div>
            <div className="plugin-frame-status-text">
              {frameStatus === "error" ? frameError || "Plugin runtime did not respond." : "Waiting for plugin runtime handshake."}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (!chrome) return frame;

  return (
    <section className="plugin-slot-card">
      <div className="plugin-slot-card-header">
        <div>
          <div className="plugin-slot-card-title">{title || plugin.name}</div>
          <div className="plugin-slot-card-meta">{plugin.name} · v{plugin.version}</div>
        </div>
      </div>
      {frame}
    </section>
  );
}

export function PluginActionBar({
  location,
  contextPayload,
  className
}: {
  location: PluginActionLocation;
  contextPayload?: Record<string, unknown>;
  className?: string;
}) {
  const { getActionContributions, runPluginAction } = usePlugins();
  const items = getActionContributions(location);
  if (items.length === 0) return null;
  return (
    <div className={className || "flex flex-wrap items-center gap-1.5"}>
      {items.map(({ plugin, action }) => (
        <button
          key={`${plugin.id}:${action.id}`}
          type="button"
          onClick={() => { void runPluginAction(plugin, action, contextPayload); }}
          className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
            action.variant === "accent"
              ? "border-accent-border bg-accent-subtle text-accent hover:bg-accent/20"
              : "border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          }`}
          title={action.title}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function PluginActionToastHost() {
  const { actionStatus } = usePlugins();
  if (!actionStatus) return null;
  return (
    <div className={`plugin-action-toast ${actionStatus.tone === "error" ? "is-error" : "is-success"}`}>
      {actionStatus.text}
    </div>
  );
}

export function PluginActionModalHost() {
  const { activeActionRequest, closePluginAction, activeTab, locale, catalogRevision } = usePlugins();
  if (!activeActionRequest) return null;
  const { plugin, action, payload } = activeActionRequest;
  return (
    <div className="plugin-action-modal-backdrop" onClick={closePluginAction}>
      <div
        className="plugin-action-modal"
        style={{ width: `min(${action.width}px, calc(100vw - 32px))` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="plugin-action-modal-header">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">{action.title}</div>
            <div className="text-[11px] text-text-tertiary">{plugin.name}</div>
          </div>
          <button
            type="button"
            onClick={closePluginAction}
            className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover"
          >
            ×
          </button>
        </div>
        <PluginFrame
          plugin={plugin}
          url={action.url}
          title={action.title}
          activeTab={activeTab}
          locale={locale}
          defaultHeight={action.height}
          contextPayload={{
            ...(payload || {}),
            actionId: action.id,
            actionLocation: action.location
          }}
          instanceKey={`action:${plugin.id}:${action.id}:${catalogRevision}`}
          className="plugin-action-frame"
        />
      </div>
    </div>
  );
}

export function PluginSlotMount({
  slotId,
  contextPayload,
  instanceKey
}: {
  slotId: PluginSlotId;
  contextPayload?: Record<string, unknown>;
  instanceKey?: string;
}) {
  const { getSlotContributions, activeTab, locale, catalogRevision } = usePlugins();
  const items = getSlotContributions(slotId);
  if (items.length === 0) return null;
  return (
    <div className="plugin-slot-stack">
      {items.map(({ plugin, slot }) => (
        <PluginFrame
          key={`${plugin.id}:${slot.id}:${instanceKey || "default"}:${catalogRevision}`}
          plugin={plugin}
          url={slot.url}
          title={slot.title}
          activeTab={activeTab}
          locale={locale}
          defaultHeight={slot.height}
          contextPayload={contextPayload}
          instanceKey={instanceKey}
          chrome
        />
      ))}
    </div>
  );
}
