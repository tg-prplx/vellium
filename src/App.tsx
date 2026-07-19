import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PluginActionBar, PluginActionModalHost, PluginActionToastHost, PluginFrame, PluginProvider, usePlugins } from "./features/plugins/PluginHost";
import { I18nContext, translations, useI18n, type Locale } from "./shared/i18n";
import { api } from "./shared/api";
import { TitleBar } from "./components/TitleBar";
import { TaskManager } from "./components/TaskManager";
import type { BackgroundTaskScope } from "./shared/backgroundTasks";
import type { AppSettings, PluginCatalog, PluginDescriptor } from "./shared/types/contracts";
import { hasCompletedWelcomeTour, resetWelcomeTourProgress, WelcomeTour, WELCOME_TOUR_START_EVENT } from "./features/welcome/WelcomeTour";
import {
  applyStoredWallpaperTheme,
  applyWallpaperThemePalette,
  clearWallpaperTheme,
  generateWallpaperThemePalette,
  isWallpaperThemeEnabled,
  readWallpaperThemePalette,
  storeWallpaperThemePalette
} from "./shared/wallpaperTheme";

const ChatScreen = lazy(() => import("./features/chat/ChatScreen").then((module) => ({ default: module.ChatScreen })));
const WritingScreen = lazy(() => import("./features/writer/WritingScreen").then((module) => ({ default: module.WritingScreen })));
const CharactersScreen = lazy(() => import("./features/characters/CharactersScreen").then((module) => ({ default: module.CharactersScreen })));
const PetsScreen = lazy(() => import("./features/pets/PetsScreen").then((module) => ({ default: module.PetsScreen })));
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

function AppContent({
  locale,
  activeTab,
  setActiveTab
}: {
  locale: Locale;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}) {
  const { t } = useI18n();
  const { pluginTabs, catalogRevision } = usePlugins();
  const [pendingAgentThreadId, setPendingAgentThreadId] = useState<string | null>(null);
  const [pendingSettingsView, setPendingSettingsView] = useState<{ category?: string; sectionId?: string } | null>(null);
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia("(max-width: 480px)").matches);
  const navRef = useRef<HTMLElement | null>(null);

  const coreTabs = useMemo<AppTab[]>(() => {
    return [
      { id: "chat", label: t("tab.chat"), icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z", kind: "core" },
      { id: "writing", label: t("tab.writing"), icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z", kind: "core" },
      { id: "characters", label: t("tab.characters"), icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z", kind: "core" },
      { id: "character-forge", label: t("writing.characterForge"), icon: "M12 3v2m6.364.636l-1.414 1.414M21 12h-2M5 12H3m4.05-4.95L5.636 5.636M9 18h6m-5 3h4m-5.5-7.5a5 5 0 117 0c-.9.7-1.5 1.65-1.5 2.5h-4c0-.85-.6-1.8-1.5-2.5z", kind: "core" },
      { id: "pets", label: t("tab.pets"), icon: "M7.5 9.5C5.6 9.2 4 7.8 4 6.1c0-1.2.8-2.1 1.9-2.1 1.4 0 2.4 1.5 2.8 3.2M16.5 9.5c1.9-.3 3.5-1.7 3.5-3.4 0-1.2-.8-2.1-1.9-2.1-1.4 0-2.4 1.5-2.8 3.2M5.5 13.6C5.5 9.9 8.4 7 12 7s6.5 2.9 6.5 6.6c0 3.4-2.4 5.9-6.5 5.9s-6.5-2.5-6.5-5.9z", kind: "core" },
      { id: "lorebooks", label: t("tab.lorebooks"), icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5A4.5 4.5 0 003 9.5v9A4.5 4.5 0 017.5 14c1.746 0 3.332.477 4.5 1.253m0-9c1.168-.776 2.754-1.253 4.5-1.253A4.5 4.5 0 0121 9.5v9a4.5 4.5 0 00-4.5-4.5c-1.746 0-3.332.477-4.5 1.253", kind: "core" },
      { id: "knowledge", label: t("tab.knowledge"), icon: "M3 7a2 2 0 012-2h4.5a2 2 0 011.6.8l1.8 2.4H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z", kind: "core" },
      { id: "settings", label: t("tab.settings"), icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z", kind: "core" }
    ];
  }, [t]);

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

  useEffect(() => {
    setOpenNavGroup(null);
  }, [activeTab]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 480px)");
    const syncCompactNavigation = () => {
      setCompactNavigation(media.matches);
      setOpenNavGroup(null);
    };
    syncCompactNavigation();
    media.addEventListener("change", syncCompactNavigation);
    return () => media.removeEventListener("change", syncCompactNavigation);
  }, []);

  useEffect(() => {
    if (!openNavGroup) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !navRef.current?.contains(target)) setOpenNavGroup(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenNavGroup(null);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openNavGroup]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      const threadId = typeof detail?.threadId === "string" ? detail.threadId.trim() : "";
      if (!threadId) return;
      setPendingAgentThreadId(threadId);
      setPendingSettingsView({ category: "legacy", sectionId: "settings-legacy" });
      setActiveTab("settings");
    };
    window.addEventListener("open-agents-thread", handler);
    return () => window.removeEventListener("open-agents-thread", handler);
  }, [setActiveTab]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ category?: string; sectionId?: string }>).detail;
      if (detail?.category === "agents") {
        setPendingSettingsView({ category: "legacy", sectionId: "settings-legacy" });
        setActiveTab("settings");
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("open-legacy-view")), 0);
        return;
      }
      setPendingSettingsView({
        category: typeof detail?.category === "string" ? detail.category : undefined,
        sectionId: typeof detail?.sectionId === "string" ? detail.sectionId : undefined
      });
      setActiveTab("settings");
    };
    window.addEventListener("open-settings-view", handler);
    return () => window.removeEventListener("open-settings-view", handler);
  }, [setActiveTab]);

  const content = useMemo(() => {
    if (activeTab === "chat") return null;
    if (activeTab === "writing") return <WritingScreen key="writing-books" initialWorkspaceMode="books" lockWorkspaceMode />;
    if (activeTab === "characters") return <CharactersScreen />;
    if (activeTab === "character-forge") return <WritingScreen key="character-forge" initialWorkspaceMode="characters" lockWorkspaceMode />;
    if (activeTab === "pets") return <PetsScreen />;
    if (activeTab === "lorebooks") return <LorebooksScreen />;
    if (activeTab === "knowledge") return <KnowledgeScreen />;
    if (activeTab === "settings") {
      return (
        <SettingsScreen
          initialCategory={pendingSettingsView?.category}
          initialSectionId={pendingSettingsView?.sectionId}
          onInitialViewHandled={() => setPendingSettingsView(null)}
          initialLegacyAgentThreadId={pendingAgentThreadId}
          onInitialLegacyAgentThreadHandled={() => setPendingAgentThreadId(null)}
        />
      );
    }
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
  }, [activeTab, tabs, locale, pendingAgentThreadId, pendingSettingsView]);

  const isElectron = !!window.electronAPI;

  function openTaskScope(scope: BackgroundTaskScope) {
    if (scope === "agents") {
      setPendingSettingsView({ category: "legacy", sectionId: "settings-legacy" });
      setActiveTab("settings");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("open-legacy-view", { detail: { view: "agents" } }));
      }, 0);
      return;
    }
    setActiveTab(scope);
  }

  const noDrag = isElectron
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  const brandNode = (
    <div className="app-brand flex items-center gap-2.5">
      <div className="app-brand-mark flex h-8 w-8 items-center justify-center rounded-xl bg-accent">
        <svg className="h-4 w-4 text-text-inverse" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>
      <span className="text-sm font-semibold text-text-primary">{t("app.name")}</span>
    </div>
  );

  const tabGroups = useMemo(() => {
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const pick = (ids: string[]) => ids.flatMap((id) => {
      const tab = byId.get(id);
      return tab ? [tab] : [];
    });
    return [
      { id: "work", label: t("tab.groupWork"), tabs: pick(["chat", "writing"]) },
      { id: "characters", label: t("tab.groupCharacters"), tabs: pick(["characters", "character-forge", "pets"]) },
      { id: "knowledge", label: t("tab.groupKnowledge"), tabs: pick(["knowledge", "lorebooks"]) },
      { id: "settings", label: t("tab.settings"), tabs: pick(["settings"]) },
      { id: "plugins", label: t("tab.groupPlugins"), tabs: tabs.filter((tab) => tab.kind === "plugin") }
    ].filter((group) => group.tabs.length > 0);
  }, [tabs]);

  const renderTabsNode = (mobile = false) => (
    <nav
      ref={navRef}
      className={`app-nav ${mobile ? "app-mobile-nav" : ""} my-1.5 flex items-center gap-1 rounded-lg border border-border-subtle bg-bg-secondary p-1`}
      style={noDrag}
      aria-label={mobile ? t("app.name") : undefined}
    >
      {tabGroups.map((group) => {
        const activeGroupTab = group.tabs.find((tab) => tab.id === activeTab);
        const triggerTab = activeGroupTab || group.tabs[0];
        const isGroupActive = Boolean(activeGroupTab);
        const isMenuOpen = openNavGroup === group.id;
        return (
          <div key={group.id} className={`app-nav-group ${isGroupActive ? "is-active" : ""} ${isMenuOpen ? "is-open" : ""}`}>
            <button
              type="button"
              aria-haspopup={group.tabs.length > 1 ? "menu" : undefined}
              aria-expanded={group.tabs.length > 1 ? isMenuOpen : undefined}
              aria-controls={group.tabs.length > 1 ? `app-nav-menu-${mobile ? "mobile-" : ""}${group.id}` : undefined}
              onClick={() => {
                if (group.tabs.length > 1) {
                  setOpenNavGroup((current) => current === group.id ? null : group.id);
                  return;
                }
                setActiveTab(triggerTab.id);
              }}
              className={`app-tab-button app-nav-trigger flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isGroupActive
                  ? "is-active bg-bg-hover text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              <TabIcon path={triggerTab.icon} />
              <span>{group.label}</span>
              {activeGroupTab && group.tabs.length > 1 ? <span className="app-nav-current">{activeGroupTab.label}</span> : null}
              {group.tabs.length > 1 ? <span className="app-nav-chevron" aria-hidden="true">⌄</span> : null}
            </button>
            {group.tabs.length > 1 && isMenuOpen ? (
              <div id={`app-nav-menu-${mobile ? "mobile-" : ""}${group.id}`} className="app-nav-menu" role="menu">
                <div className="app-nav-menu-label">{group.label}</div>
                {group.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveTab(tab.id);
                      setOpenNavGroup(null);
                    }}
                    className={`app-nav-menu-item ${activeTab === tab.id ? "is-active" : ""}`}
                  >
                    <span className="app-nav-menu-icon"><TabIcon path={tab.icon} /></span>
                    <span className="app-nav-menu-copy">{tab.label}</span>
                    {activeTab === tab.id ? (
                      <svg className="app-nav-menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );

  const toolbarNode = (
    <div className="flex items-center gap-2" style={noDrag}>
      <TaskManager isElectron={isElectron} onOpenScope={openTaskScope} />
      <PluginActionBar location="app.toolbar" />
    </div>
  );

  return (
    <div className="app-shell flex h-full w-full flex-col overflow-hidden bg-bg-primary">
      {isElectron ? (
        <TitleBar>
          <div className="app-header-inner flex w-full min-w-0 items-center px-7 py-1.5">
            <div className="app-header-layout grid w-full min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="app-header-brand justify-self-start" style={noDrag}>
                {brandNode}
              </div>
              <div className="app-header-nav min-w-0 justify-self-center">
                {!compactNavigation ? renderTabsNode() : null}
              </div>
              <div className="app-header-tools justify-self-end" style={noDrag}>
                {toolbarNode}
              </div>
            </div>
          </div>
        </TitleBar>
      ) : (
        <header className="app-header relative z-[80] flex-shrink-0 overflow-visible border-b border-border">
          <div className="app-header-inner flex w-full min-w-0 items-center px-7 py-4">
            <div className="app-header-layout grid w-full min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="app-header-brand justify-self-start">{brandNode}</div>
              <div className="app-header-nav min-w-0 justify-self-center">{!compactNavigation ? renderTabsNode() : null}</div>
              <div className="app-header-tools justify-self-end">{toolbarNode}</div>
            </div>
          </div>
        </header>
      )}

      <main className="app-main w-full flex-1 overflow-hidden p-4">
        <div className="tab-content-enter h-full">
          <Suspense fallback={<ScreenFallback />}>
            <div
              className={`app-screen-keepalive h-full ${activeTab === "chat" ? "is-active" : "is-hidden"}`}
              aria-hidden={activeTab === "chat" ? undefined : true}
            >
              <ChatScreen />
            </div>
            {activeTab !== "chat" ? content : null}
          </Suspense>
        </div>
      </main>
      {compactNavigation ? renderTabsNode(true) : null}
    </div>
  );
}

function AppWorkspace({ locale }: { locale: Locale }) {
  const [activeTab, setActiveTab] = useState<string>("chat");
  const [welcomeTourOpen, setWelcomeTourOpen] = useState(() => !hasCompletedWelcomeTour());

  useEffect(() => {
    const startTour = () => setWelcomeTourOpen(true);
    window.addEventListener(WELCOME_TOUR_START_EVENT, startTour);
    return () => window.removeEventListener(WELCOME_TOUR_START_EVENT, startTour);
  }, []);

  const handleTourNavigate = useCallback((navigation: {
    tab?: string;
    settingsCategory?: string;
    settingsSectionId?: string;
  }) => {
    if (navigation.tab) setActiveTab(navigation.tab);
    if (navigation.settingsCategory || navigation.settingsSectionId) {
      window.dispatchEvent(new CustomEvent("open-settings-view", {
        detail: {
          category: navigation.settingsCategory,
          sectionId: navigation.settingsSectionId
        }
      }));
    }
  }, []);

  return (
    <PluginProvider locale={locale} activeTab={activeTab}>
      <AppContent locale={locale} activeTab={activeTab} setActiveTab={setActiveTab} />
      <WelcomeTour
        open={welcomeTourOpen}
        onClose={() => setWelcomeTourOpen(false)}
        onNavigate={handleTourNavigate}
      />
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
  const wallpaperPresent = root.dataset.simpleWallpaper === "active";
  clearWallpaperTheme(root);
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
  applyStoredWallpaperTheme(wallpaperPresent, root);
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

type DisplaySettings = Pick<
  AppSettings,
  | "fontScale"
  | "density"
  | "simpleModeWallpaper"
  | "simpleModeWallpaperDim"
  | "simpleModeWallpaperBlur"
  | "simpleModeWallpaperPosition"
>;

function applyDisplaySettings(settings: DisplaySettings) {
  const root = document.documentElement;
  const fontScale = Number(settings.fontScale);
  const safeFontScale = Number.isFinite(fontScale) ? Math.max(0.65, Math.min(1.5, fontScale)) : 1;
  const wallpaper = typeof settings.simpleModeWallpaper === "string" && settings.simpleModeWallpaper.startsWith("data:image/")
    ? settings.simpleModeWallpaper
    : "";
  const dim = Number(settings.simpleModeWallpaperDim);
  const blur = Number(settings.simpleModeWallpaperBlur);
  const position = settings.simpleModeWallpaperPosition === "top" || settings.simpleModeWallpaperPosition === "bottom"
    ? settings.simpleModeWallpaperPosition
    : "center";
  root.style.setProperty("--app-font-scale", String(safeFontScale));
  if (window.electronAPI?.setZoomFactor) {
    root.style.setProperty("--app-ui-scale", "1");
    void window.electronAPI.setZoomFactor(safeFontScale).catch(() => {
      root.style.setProperty("--app-ui-scale", String(safeFontScale));
    });
  } else {
    root.style.setProperty("--app-ui-scale", String(safeFontScale));
  }
  root.style.setProperty("--simple-wallpaper-image", wallpaper ? `url(${JSON.stringify(wallpaper)})` : "none");
  root.style.setProperty("--simple-wallpaper-dim", String(Number.isFinite(dim) ? Math.max(0.15, Math.min(0.9, dim)) : 0.6));
  root.style.setProperty("--simple-wallpaper-blur", `${Number.isFinite(blur) ? Math.max(0, Math.min(24, blur)) : 0}px`);
  root.style.setProperty("--simple-wallpaper-position", position);
  root.dataset.simpleWallpaper = wallpaper ? "active" : "none";
  applyStoredWallpaperTheme(Boolean(wallpaper), root);
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
      if (s.simpleModeWallpaper && isWallpaperThemeEnabled() && !readWallpaperThemePalette()) {
        void generateWallpaperThemePalette(s.simpleModeWallpaper).then((palette) => {
          storeWallpaperThemePalette(palette);
          applyWallpaperThemePalette(palette);
        }).catch(() => {});
      }
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
      const detail = (e as CustomEvent<DisplaySettings>).detail;
      if (!detail || typeof detail !== "object") return;
      applyDisplaySettings(detail);
    };
    const onboardingResetHandler = (e: Event) => {
      const next = (e as CustomEvent<AppSettings>).detail;
      if (!next) return;
      resetWelcomeTourProgress();
      setInitialSettings(next);
      void applyThemeFromSettings(next);
      applyDisplaySettings(next);
      if (isSupportedLocale(next.interfaceLanguage)) {
        setLocale(next.interfaceLanguage);
      }
    };
    const settingsChangeHandler = (e: Event) => {
      const next = (e as CustomEvent<AppSettings>).detail;
      if (!next || typeof next !== "object") return;
      setInitialSettings(next);
    };
    window.addEventListener("locale-change", handler);
    window.addEventListener("theme-change", themeHandler);
    window.addEventListener("display-settings-change", displayHandler);
    window.addEventListener("onboarding-reset", onboardingResetHandler);
    window.addEventListener("settings-change", settingsChangeHandler);
    return () => {
      window.removeEventListener("locale-change", handler);
      window.removeEventListener("theme-change", themeHandler);
      window.removeEventListener("display-settings-change", displayHandler);
      window.removeEventListener("onboarding-reset", onboardingResetHandler);
      window.removeEventListener("settings-change", settingsChangeHandler);
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
