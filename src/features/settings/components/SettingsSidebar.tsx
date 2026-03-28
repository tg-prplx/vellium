import { StatusMessage } from "./FormControls";
import type { SettingsCategory, SettingsCategoryNavItem, SettingsSectionLink } from "../config";

interface SettingsSidebarProps {
  activeProviderName: string;
  activeModel: string;
  activeCategory: SettingsCategory;
  categoryNav: SettingsCategoryNavItem[];
  categorySections: Record<SettingsCategory, SettingsSectionLink[]>;
  quickJumpFilter: string;
  visibleQuickSections: SettingsSectionLink[];
  statusText: string;
  statusVariant: "info" | "success" | "error";
  onCategoryChange: (category: SettingsCategory) => void;
  onDangerZoneClick: () => void;
  onQuickJumpFilterChange: (value: string) => void;
  onQuickSectionClick: (sectionId: string) => void;
  t: (key: any) => string;
}

export function SettingsSidebar({
  activeProviderName,
  activeModel,
  activeCategory,
  categoryNav,
  categorySections,
  quickJumpFilter,
  visibleQuickSections,
  statusText,
  statusVariant,
  onCategoryChange,
  onDangerZoneClick,
  onQuickJumpFilterChange,
  onQuickSectionClick,
  t
}: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar">
      <div className="settings-sidebar-status">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
          {t("settings.activeModel")}
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
        {categoryNav.map((category) => (
          <button
            key={category.id}
            onClick={() => onCategoryChange(category.id)}
            className={`settings-nav-item ${activeCategory === category.id ? "is-active" : ""}`}
          >
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={category.icon} />
            </svg>
            <span className="min-w-0 flex-1 truncate">{category.label}</span>
            <span className="settings-nav-count">{categorySections[category.id].length}</span>
          </button>
        ))}
        <div className="settings-nav-divider" />
        <button
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

      <div className="settings-sidebar-jump">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
          {t("settings.quickJump")}
        </div>
        <input
          type="text"
          value={quickJumpFilter}
          onChange={(event) => onQuickJumpFilterChange(event.target.value)}
          placeholder={t("settings.searchSections")}
          className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
        />
        <div className="mt-2 max-h-[220px] space-y-1 overflow-y-auto pr-1">
          {visibleQuickSections.length > 0 ? (
            visibleQuickSections.map((section) => (
              <button
                key={section.id}
                onClick={() => onQuickSectionClick(section.id)}
                className="settings-quick-jump-item"
              >
                <span className="truncate">{section.label}</span>
              </button>
            ))
          ) : (
            <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-tertiary">
              {t("settings.noMatchingSections")}
            </div>
          )}
        </div>
      </div>

      <div className="settings-sidebar-footer">
        <StatusMessage text={statusText} variant={statusVariant} />
      </div>
    </aside>
  );
}
