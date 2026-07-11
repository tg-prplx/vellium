import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import type { AppSettings } from "../../shared/types/contracts";
import { AgentsScreen } from "../agents/public";

type LegacyView = "overview" | "agents";

export function LegacyScreen({
  initialAgentThreadId,
  onInitialAgentThreadHandled,
  embedded = false
}: {
  initialAgentThreadId?: string | null;
  onInitialAgentThreadHandled?: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<LegacyView>(initialAgentThreadId ? "agents" : "overview");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState<"agents" | "interface" | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    api.settingsGet()
      .then(setSettings)
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (initialAgentThreadId) setView("agents");
  }, [initialAgentThreadId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const requestedView = (event as CustomEvent<{ view?: LegacyView }>).detail?.view;
      setView(requestedView === "agents" ? "agents" : "overview");
    };
    window.addEventListener("open-legacy-view", handler);
    return () => window.removeEventListener("open-legacy-view", handler);
  }, []);

  async function updateLegacySetting(
    kind: "agents" | "interface",
    patch: Partial<AppSettings>
  ) {
    setSaving(kind);
    setStatus("");
    try {
      const updated = await api.settingsUpdate(patch);
      setSettings(updated);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
      setStatus(t("legacy.saved"));
    } catch (error) {
      setStatus(`${t("legacy.saveFailed")}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(null);
    }
  }

  if (view === "agents" && settings?.agentsEnabled) {
    return (
      <div className={embedded ? "flex min-h-[680px] flex-col overflow-hidden rounded-2xl border border-border" : "flex h-full min-h-0 flex-col"}>
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-bg-secondary px-4 py-2">
          <button
            type="button"
            onClick={() => setView("overview")}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover"
          >
            ← {t("legacy.back")}
          </button>
          <span className="rounded-full border border-warning-border bg-warning-subtle px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">
            {t("legacy.badge")}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <AgentsScreen
            initialThreadId={initialAgentThreadId}
            onInitialThreadHandled={onInitialAgentThreadHandled}
          />
        </div>
      </div>
    );
  }

  const legacyInterfaceEnabled = settings?.alternateSimpleMode === false;

  return (
    <div className={embedded ? "" : "h-full overflow-y-auto p-4 md:p-6"}>
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-warning-border bg-warning-subtle p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text-primary">{t("legacy.title")}</h1>
            <span className="rounded-full border border-warning-border bg-bg-primary px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">
              {t("legacy.badge")}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary">{t("legacy.description")}</p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-border bg-bg-secondary p-5">
            <div className="text-base font-semibold text-text-primary">{t("legacy.agents")}</div>
            <p className="mt-2 min-h-10 text-xs leading-relaxed text-text-tertiary">{t("legacy.agentsDesc")}</p>
            <label className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
              <span className="text-sm font-medium text-text-secondary">{t("legacy.agentsEnable")}</span>
              <input
                type="checkbox"
                checked={settings?.agentsEnabled === true}
                disabled={!settings || saving === "agents"}
                onChange={(event) => void updateLegacySetting("agents", { agentsEnabled: event.target.checked })}
              />
            </label>
            <button
              type="button"
              disabled={!settings?.agentsEnabled}
              onClick={() => setView("agents")}
              className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-text-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("legacy.agentsOpen")}
            </button>
          </section>

          <section className="rounded-2xl border border-border bg-bg-secondary p-5">
            <div className="text-base font-semibold text-text-primary">{t("legacy.interface")}</div>
            <p className="mt-2 min-h-10 text-xs leading-relaxed text-text-tertiary">{t("legacy.interfaceDesc")}</p>
            <label className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
              <span className="text-sm font-medium text-text-secondary">
                {legacyInterfaceEnabled ? t("legacy.interfaceEnable") : t("legacy.simpleActive")}
              </span>
              <input
                type="checkbox"
                checked={legacyInterfaceEnabled}
                disabled={!settings || saving === "interface"}
                onChange={(event) => void updateLegacySetting("interface", {
                  alternateSimpleMode: !event.target.checked
                })}
              />
            </label>
          </section>
        </div>

        {status ? (
          <div className="mt-4 rounded-xl border border-border-subtle bg-bg-secondary px-4 py-3 text-xs text-text-secondary">
            {status}
          </div>
        ) : null}
      </div>
    </div>
  );
}
