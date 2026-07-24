import { useEffect, useState } from "react";
import { api } from "../shared/api";
import { useI18n } from "../shared/i18n";
import type { AppUpdateInfo } from "../shared/types/contracts";

export function UpdateNotification() {
  const { t } = useI18n();
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void api.appUpdateLatest()
        .then((result) => {
          if (active && result.updateAvailable) setUpdate(result);
        })
        .catch(() => {
          // Update checks are best-effort and must never interrupt startup.
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (!update || dismissed) return null;

  const openRelease = () => {
    if (window.electronAPI?.openExternal) {
      void window.electronAPI.openExternal(update.releaseUrl).catch(() => {});
      return;
    }
    window.open(update.releaseUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <aside
      className="fixed bottom-5 right-5 z-[250] w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-bg-secondary p-4 shadow-2xl"
      aria-live="polite"
      aria-label={t("updates.availableTitle")}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-subtle text-accent">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{t("updates.availableTitle")}</div>
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            {t("updates.availableBody")
              .replace("{current}", update.currentVersion)
              .replace("{latest}", update.latestVersion)}
          </p>
          <button
            type="button"
            className="mt-3 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse transition-opacity hover:opacity-90"
            onClick={openRelease}
          >
            {t("updates.openRelease")}
          </button>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          onClick={() => setDismissed(true)}
          aria-label={t("updates.dismiss")}
          title={t("updates.dismiss")}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
