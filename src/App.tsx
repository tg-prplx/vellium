import { useEffect, useMemo, useState } from "react";
import { ChatScreen } from "./features/chat/ChatScreen";
import { WritingScreen } from "./features/writer/WritingScreen";
import { CharactersScreen } from "./features/characters/CharactersScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { I18nContext, useI18n, type Locale } from "./shared/i18n";
import { api } from "./shared/api";
import { TitleBar } from "./components/TitleBar";

type TabId = "chat" | "writing" | "characters" | "settings";

function TabIcon({ path }: { path: string }) {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

function AppContent() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>("chat");

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "chat", label: t("tab.chat"), icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
    { id: "writing", label: t("tab.writing"), icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
    { id: "characters", label: t("tab.characters"), icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
    { id: "settings", label: t("tab.settings"), icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" }
  ];

  const content = useMemo(() => {
    if (activeTab === "chat") return <ChatScreen />;
    if (activeTab === "writing") return <WritingScreen />;
    if (activeTab === "characters") return <CharactersScreen />;
    return <SettingsScreen />;
  }, [activeTab]);

  const isElectron = !!window.electronAPI;

  const noDrag = isElectron
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  const headerContent = (
    <>
      <div className="flex items-center gap-2.5" style={noDrag}>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
          <svg className="h-4 w-4 text-text-inverse" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-text-primary">{t("app.name")}</span>
      </div>

      <nav
        className="app-nav ml-4 flex items-center gap-1 rounded-lg bg-bg-secondary p-1"
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
    </>
  );

  return (
    <div className="app-shell flex h-screen w-screen flex-col overflow-hidden bg-bg-primary">
      {isElectron ? (
        <TitleBar>
          <div className="mx-auto flex max-w-[1600px] items-center px-5 py-1">
            {headerContent}
          </div>
        </TitleBar>
      ) : (
        <header className="flex-shrink-0 border-b border-border">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-2.5">
            {headerContent}
          </div>
        </header>
      )}

      <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-hidden p-4">
        <div key={activeTab} className="tab-content-enter h-full">
          {content}
        </div>
      </main>
    </div>
  );
}

export function App() {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    api.settingsGet().then((s) => {
      if (s.interfaceLanguage === "ru" || s.interfaceLanguage === "en") {
        setLocale(s.interfaceLanguage);
      }
    }).catch(() => {});

    const handler = (e: Event) => {
      setLocale((e as CustomEvent).detail as Locale);
    };
    window.addEventListener("locale-change", handler);
    return () => window.removeEventListener("locale-change", handler);
  }, []);

  return (
    <I18nContext.Provider value={locale}>
      <AppContent />
    </I18nContext.Provider>
  );
}
