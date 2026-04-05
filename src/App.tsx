import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { PluginActionBar, PluginActionModalHost, PluginActionToastHost, PluginFrame, PluginProvider, usePlugins } from "./features/plugins/PluginHost";
import { I18nContext, translations, useI18n, type Locale } from "./shared/i18n";
import { api } from "./shared/api";
import { TitleBar } from "./components/TitleBar";
import type { AppSettings, PluginCatalog, PluginDescriptor } from "./shared/types/contracts";
import { useBackgroundTasks } from "./shared/backgroundTasks";

const ChatScreen = lazy(() => import("./features/chat/ChatScreen").then((module) => ({ default: module.ChatScreen })));
const WritingScreen = lazy(() => import("./features/writer/WritingScreen").then((module) => ({ default: module.WritingScreen })));
const CharactersScreen = lazy(() => import("./features/characters/CharactersScreen").then((module) => ({ default: module.CharactersScreen })));
const LorebooksScreen = lazy(() => import("./features/lorebooks/LorebooksScreen").then((module) => ({ default: module.LorebooksScreen })));
const KnowledgeScreen = lazy(() => import("./features/knowledge/KnowledgeScreen").then((module) => ({ default: module.KnowledgeScreen })));
const SettingsScreen = lazy(() => import("./features/settings/SettingsScreen").then((module) => ({ default: module.SettingsScreen })));
const WelcomeScreen = lazy(() => import("./features/welcome/WelcomeScreen").then((module) => ({ default: module.WelcomeScreen })));

type AppTab = {
  id: string;
  label: string;
  icon: string;
  kind: "core" | "plugin";
  pluginUrl?: string;
  plugin?: PluginDescriptor;
};

function TabIcon({ path }: { path: string }) {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

function ScreenFallback() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-border-subtle bg-bg-secondary/60">
      <div className="text-sm text-text-tertiary">Loading workspace...</div>
    </div>
  );
}

function BackgroundTaskChip() {
  const tasks = useBackgroundTasks();
  const runningTasks = useMemo(
    () => tasks.filter((task) => task.status === "running"),
    [tasks]
  );

  if (runningTasks.length === 0) return null;

  const leadTask = runningTasks[0];
  const extraCount = runningTasks.length - 1;

  return (
    <div
      className="flex max-w-[260px] items-center gap-2 rounded-full border border-border-subtle bg-bg-secondary px-3 py-1.5 text-[11px] text-text-secondary"
      title={runningTasks.map((task) => task.label).join("\n")}
    >
      <svg className="h-3.5 w-3.5 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="truncate text-text-primary">{leadTask.label}</span>
      {extraCount > 0 && (
        <span className="rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
          +{extraCount}
        </span>
      )}
    </div>
  );
}

function AppContent({ locale, activeTab, setActiveTab }: { locale: Locale; activeTab: string; setActiveTab: (tab: string) => void }) {
  const { t } = useI18n();
  const { pluginTabs, catalogRevision } = usePlugins();

  const coreTabs = useMemo<AppTab[]>(() => [
    { id: "chat", label: t("tab.chat"), icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z", kind: "core" },
    { id: "writing", label: t("tab.writing"), icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z", kind: "core" },
    { id: "characters", label: t("tab.characters"), icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z", kind: "core" },
    { id: "lorebooks", label: t("tab.lorebooks"), icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5A4.5 4.5 0 003 9.5v9A4.5 4.5 0 017.5 14c1.746 0 3.332.477 4.5 1.253m0-9c1.168-.776 2.754-1.253 4.5-1.253A4.5 4.5 0 0121 9.5v9a4.5 4.5 0 00-4.5-4.5c-1.746 0-3.332.477-4.5 1.253", kind: "core" },
    { id: "knowledge", label: t("tab.knowledge"), icon: "M3 7a2 2 0 012-2h4.5a2 2 0 011.6.8l1.8 2.4H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z", kind: "core" },
    { id: "settings", label: t("tab.settings"), icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z", kind: "core" }
  ], [t]);

  const tabs = useMemo<AppTab[]>(() => {
    const pluginTabDefs = pluginTabs.map(({ plugin, tab }) => ({
      id: `plugin:${plugin.id}:${tab.id}`,
      label: tab.label,
      icon: "M11 3.055A9.004 9.004 0 1020.945 13H17a1 1 0 01-1-1V8.055A9.005 9.005 0 0011 3.055z",
      kind: "plugin" as const,
      pluginUrl: tab.url,
      plugin
    }));
    return [...coreTabs, ...pluginTabDefs];
  }, [coreTabs, pluginTabs]);

  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab("chat");
  }, [tabs, activeTab]);

  const content = useMemo(() => {
    if (activeTab === "chat") return <ChatScreen />;
    if (activeTab === "writing") return <WritingScreen />;
    if (activeTab === "characters") return <CharactersScreen />;
    if (activeTab === "lorebooks") return <LorebooksScreen />;
    if (activeTab === "knowledge") return <KnowledgeScreen />;
    if (activeTab === "settings") return <SettingsScreen />;
    const pluginTab = tabs.find((tab) => tab.id === activeTab && tab.kind === "plugin");
    if (!pluginTab?.plugin || !pluginTab.pluginUrl) return <SettingsScreen />;
    return (
      <PluginFrame
        plugin={pluginTab.plugin}
        url={pluginTab.pluginUrl}
        activeTab={activeTab}
        locale={locale}
        defaultHeight={1200}
        instanceKey={`tab:${pluginTab.plugin.id}:${pluginTab.id}:${catalogRevision}`}
        className="plugin-tab-frame"
      />
    );
  }, [activeTab, tabs, locale]);

  const isElectron = !!window.electronAPI;

  const noDrag = isElectron
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  const brandNode = (
    <div className="flex items-center gap-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
        <svg className="h-4 w-4 text-text-inverse" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>
      <span className="text-sm font-semibold text-text-primary">{t("app.name")}</span>
    </div>
  );

  const tabsNode = (
    <nav
      className="app-nav my-1.5 flex items-center gap-1 rounded-lg border border-border-subtle bg-bg-secondary p-1"
      style={noDrag}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`app-tab-button flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === tab.id
              ? "is-active bg-bg-hover text-text-primary"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          <TabIcon path={tab.icon} />
          {tab.label}
        </button>
      ))}
    </nav>
  );

  const toolbarNode = (
    <div className="flex items-center gap-2" style={noDrag}>
      <BackgroundTaskChip />
      <PluginActionBar location="app.toolbar" />
    </div>
  );

  return (
    <div className="app-shell flex h-full w-full flex-col overflow-hidden bg-bg-primary">
      {isElectron ? (
        <TitleBar>
          <div className="flex w-full items-center px-7 py-1.5">
            <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="justify-self-start" style={noDrag}>
                {brandNode}
              </div>
              <div className="justify-self-center">
                {tabsNode}
              </div>
              <div className="justify-self-end" style={noDrag}>
                {toolbarNode}
              </div>
            </div>
          </div>
        </TitleBar>
      ) : (
        <header className="flex-shrink-0 border-b border-border">
          <div className="flex w-full items-center px-7 py-4">
            <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="justify-self-start">{brandNode}</div>
              <div className="justify-self-center">{tabsNode}</div>
              <div className="justify-self-end">{toolbarNode}</div>
            </div>
          </div>
        </header>
      )}

      <main className="w-full flex-1 overflow-hidden p-4">
        <div className="tab-content-enter h-full">
          <Suspense fallback={<ScreenFallback />}>
            {content}
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function AppWorkspace({ locale }: { locale: Locale }) {
  const [activeTab, setActiveTab] = useState<string>("chat");
  return (
    <PluginProvider locale={locale} activeTab={activeTab}>
      <AppContent locale={locale} activeTab={activeTab} setActiveTab={setActiveTab} />
      <PluginActionModalHost />
      <PluginActionToastHost />
    </PluginProvider>
  );
}

let activeCustomThemeKeys: string[] = [];

function clearCustomThemeVariables() {
  const root = document.documentElement;
  for (const key of activeCustomThemeKeys) {
    root.style.removeProperty(key);
  }
  activeCustomThemeKeys = [];
}

function applyTheme(theme: string, customTheme?: { base: "dark" | "light"; variables: Record<string, string> } | null) {
  const root = document.documentElement;
  clearCustomThemeVariables();
  root.classList.remove("theme-light");
  const effectiveTheme = theme === "custom" ? customTheme?.base ?? "dark" : theme;
  if (effectiveTheme === "light") {
    root.classList.add("theme-light");
  }
  if (theme === "custom" && customTheme) {
    for (const [key, value] of Object.entries(customTheme.variables)) {
      root.style.setProperty(key, value);
      activeCustomThemeKeys.push(key);
    }
  }
}

function findPluginTheme(catalog: PluginCatalog | null, pluginThemeId: string | null | undefined) {
  if (!catalog || !pluginThemeId) return null;
  for (const plugin of catalog.plugins) {
    for (const theme of plugin.themes) {
      if (`${plugin.id}:${theme.id}` === pluginThemeId) {
        return theme;
      }
    }
  }
  return null;
}

function applyDisplaySettings(settings: Pick<AppSettings, "fontScale" | "density">) {
  const root = document.documentElement;
  const fontScale = Number(settings.fontScale);
  const safeFontScale = Number.isFinite(fontScale) ? Math.max(0.65, Math.min(1.5, fontScale)) : 1;
  root.style.setProperty("--app-font-scale", String(safeFontScale));
  root.style.setProperty("--app-ui-scale", String(safeFontScale));
  root.dataset.density = settings.density === "compact" ? "compact" : "comfortable";
}

async function applyThemeFromSettings(settings: Pick<AppSettings, "theme" | "pluginThemeId">) {
  if (settings.theme !== "custom") {
    applyTheme(settings.theme ?? "dark");
    return;
  }
  try {
    const catalog = await api.pluginsList();
    applyTheme(settings.theme, findPluginTheme(catalog, settings.pluginThemeId));
  } catch {
    applyTheme("dark");
  }
}

function isSupportedLocale(value: unknown): value is Locale {
  return value === "en" || value === "ru" || value === "zh" || value === "ja";
}

export function App() {
  const [locale, setLocale] = useState<Locale>("en");
  const [initialSettings, setInitialSettings] = useState<AppSettings | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const isElectron = !!window.electronAPI;

  useEffect(() => {
    Promise.all([api.settingsGet(), api.pluginsList().catch(() => null)]).then(([s, catalog]) => {
      setInitialSettings(s);
      applyTheme(s.theme ?? "dark", findPluginTheme(catalog, s.pluginThemeId));
      applyDisplaySettings(s);
      if (isSupportedLocale(s.interfaceLanguage)) {
        setLocale(s.interfaceLanguage);
      }
    }).catch(() => {}).finally(() => setIsBooting(false));

    const handler = (e: Event) => {
      setLocale((e as CustomEvent).detail as Locale);
    };
    const themeHandler = (e: Event) => {
      const detail = (e as CustomEvent<AppSettings | string>).detail;
      if (typeof detail === "string") {
        applyTheme(detail);
        return;
      }
      if (detail && typeof detail === "object") {
        void applyThemeFromSettings(detail);
        if ("fontScale" in detail || "density" in detail) {
          applyDisplaySettings(detail);
        }
      }
    };
    const displayHandler = (e: Event) => {
      const detail = (e as CustomEvent<Pick<AppSettings, "fontScale" | "density">>).detail;
      if (!detail || typeof detail !== "object") return;
      applyDisplaySettings(detail);
    };
    const onboardingResetHandler = (e: Event) => {
      const next = (e as CustomEvent<AppSettings>).detail;
      if (!next) return;
      setInitialSettings(next);
      void applyThemeFromSettings(next);
      applyDisplaySettings(next);
      if (isSupportedLocale(next.interfaceLanguage)) {
        setLocale(next.interfaceLanguage);
      }
    };
    window.addEventListener("locale-change", handler);
    window.addEventListener("theme-change", themeHandler);
    window.addEventListener("display-settings-change", displayHandler);
    window.addEventListener("onboarding-reset", onboardingResetHandler);
    return () => {
      window.removeEventListener("locale-change", handler);
      window.removeEventListener("theme-change", themeHandler);
      window.removeEventListener("display-settings-change", displayHandler);
      window.removeEventListener("onboarding-reset", onboardingResetHandler);
    };
  }, []);

  async function completeOnboarding(patch: Partial<AppSettings>) {
    const updated = await api.settingsUpdate({ ...patch, onboardingCompleted: true });
    setInitialSettings(updated);
    await applyThemeFromSettings(updated);
    applyDisplaySettings(updated);
    if (isSupportedLocale(updated.interfaceLanguage)) {
      setLocale(updated.interfaceLanguage);
    }
  }

  return (
    <I18nContext.Provider value={locale}>
      {isBooting ? (
        <div className="flex h-screen w-screen items-center justify-center bg-bg-primary">
          <div className="text-sm text-text-tertiary">Loading...</div>
        </div>
      ) : initialSettings && !initialSettings.onboardingCompleted ? (
        <div className="app-shell flex h-screen w-screen flex-col overflow-hidden bg-bg-primary">
          {isElectron ? (
            <TitleBar>
              <div className="mx-auto flex w-full max-w-[1300px] items-center px-5 py-1">
                <div className="flex items-center gap-2.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
                    <svg className="h-4 w-4 text-text-inverse" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <span className="text-sm font-semibold text-text-primary">{translations[locale]["app.name"]}</span>
                  <span className="rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[10px] text-text-secondary">
                    {translations[locale]["welcome.setupBadge"]}
                  </span>
                </div>
              </div>
            </TitleBar>
          ) : null}
          <main className="flex-1 overflow-hidden">
            <Suspense fallback={<ScreenFallback />}>
              <WelcomeScreen
                initialSettings={initialSettings}
                onPreviewLocale={setLocale}
                onComplete={completeOnboarding}
              />
            </Suspense>
          </main>
        </div>
      ) : (
        <AppWorkspace locale={locale} />
      )}
    </I18nContext.Provider>
  );
}
