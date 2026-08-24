import { useEffect, useState } from "react";
import { StatusMessage } from "./FormControls";
import type { SettingsCategory, SettingsCategoryNavItem, SettingsSectionLink } from "../config";

interface SettingsSidebarProps {
  activeProviderName: string;
  activeModel: string;
  activeCategory: SettingsCategory;
  categoryNav: SettingsCategoryNavItem[];
  categorySections: Record<SettingsCategory, SettingsSectionLink[]>;
  statusText: string;
  statusVariant: "info" | "success" | "error";
  onCategoryChange: (category: SettingsCategory) => void;
  onDangerZoneClick: () => void;
  onOpenSearch: () => void;
  onQuickSectionClick: (sectionId: string) => void;
  t: (key: any) => string;
}

export function SettingsSidebar({
  activeProviderName,
  activeModel,
  activeCategory,
  categoryNav,
  categorySections,
  statusText,
  statusVariant,
  onCategoryChange,
  onDangerZoneClick,
  onOpenSearch,
  onQuickSectionClick,
  t
}: SettingsSidebarProps) {
  const [sectionsExpanded, setSectionsExpanded] = useState(false);
  const mainCategories = categoryNav.filter((category) => category.group === "main");
  const advancedCategories = categoryNav.filter((category) => category.group === "advanced");
  const currentSections = categorySections[activeCategory];

  useEffect(() => {
    setSectionsExpanded(false);
  }, [activeCategory]);

  function renderCategory(category: SettingsCategoryNavItem) {
    return (
      <button
        key={category.id}
        type="button"
        onClick={() => onCategoryChange(category.id)}
        className={`settings-nav-item ${activeCategory === category.id ? "is-active" : ""}`}
        title={category.description}
      >
        <svg className="settings-nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={category.icon} />
        </svg>
        <span className="min-w-0 flex-1 truncate">{category.label}</span>
      </button>
    );
  }

  return (
    <aside className="settings-sidebar">
      <button type="button" className="settings-sidebar-search" onClick={onOpenSearch}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.1-5.15a6.25 6.25 0 11-12.5 0 6.25 6.25 0 0112.5 0z" />
        </svg>
        <span>{t("settings.searchSettings")}</span>
        <kbd>⌘⇧P</kbd>
      </button>

      <div className="settings-sidebar-status">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
          {t("settings.currentSetup")}
        </div>
        <div className="space-y-1.5">
          <div className="rounded-lg border border-border-subtle bg-bg-primary px-2.5 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.provider")}</div>
            <div className="truncate text-xs font-semibold text-text-primary">{activeProviderName || "—"}</div>
          </div>
          <div className="rounded-lg border border-border-subtle bg-bg-primary px-2.5 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{t("chat.model")}</div>
            <div className="truncate text-xs font-semibold text-text-primary">{activeModel || "—"}</div>
          </div>
        </div>
      </div>

      <nav className="settings-sidebar-nav">
        <div className="settings-nav-group-label">{t("settings.mainSettings")}</div>
        {mainCategories.map(renderCategory)}
        <div className="settings-nav-group-label">{t("settings.advancedSettings")}</div>
        {advancedCategories.map(renderCategory)}
        <div className="settings-nav-divider" />
        <button
          type="button"
          onClick={onDangerZoneClick}
          className="settings-nav-item"
          style={{ color: "var(--color-danger)" }}
        >
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{t("settings.dangerZone")}</span>
        </button>
      </nav>

      <div className={`settings-sidebar-jump${sectionsExpanded ? " is-expanded" : ""}`}>
        <button
          type="button"
          className="settings-sidebar-jump-toggle"
          aria-expanded={sectionsExpanded}
          aria-controls="settings-sidebar-section-links"
          onClick={() => setSectionsExpanded((current) => !current)}
        >
          <span>{t("settings.onThisPage")}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {sectionsExpanded ? (
          <div id="settings-sidebar-section-links" className="settings-sidebar-jump-list">
            {currentSections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => onQuickSectionClick(section.id)}
                className="settings-quick-jump-item"
              >
                <span className="truncate">{section.label}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="settings-sidebar-footer">
        <StatusMessage text={statusText} variant={statusVariant} />
      </div>
    </aside>
  );
}
