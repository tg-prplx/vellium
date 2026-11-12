import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../shared/i18n";

interface TitleBarProps {
  children?: ReactNode;
  immersive?: boolean;
}

export function TitleBar({ children, immersive = false }: TitleBarProps) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<string>("");
  const [isMaximized, setIsMaximized] = useState(false);
  const isElectron = !!window.electronAPI;

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI!.getPlatform().then(setPlatform);
    window.electronAPI!.isMaximized().then(setIsMaximized);
    window.electronAPI!.onMaximizedChange(setIsMaximized);
  }, [isElectron]);

  if (!isElectron) return null;

  const isMac = platform === "darwin";
  const isWindows = platform === "win32";

  return (
    <div
      className="app-header relative z-80 flex h-12 shrink-0 items-center overflow-visible border-b border-border bg-bg-primary"
      // A translated-away drag region can still consume native pointer events.
      // The immersive overlay must receive hover even over its empty space.
      style={{ WebkitAppRegion: immersive ? "no-drag" : "drag" } as React.CSSProperties}
    >
      {/* macOS: spacer for native traffic lights */}
      {isMac && <div className="w-[78px] shrink-0" />}

      {/* Normal title bars stay draggable; interactive controls and immersive
          navigation receive pointer events through no-drag regions. */}
      <div className="flex flex-1 items-center overflow-visible">
        {children}
      </div>

      {/* Windows/Linux: custom window controls */}
      {isWindows && (
        <div
          className="flex h-full shrink-0 items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            onClick={() => window.electronAPI!.minimize()}
            className="flex h-full w-[46px] items-center justify-center text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={t("titlebar.minimize")}
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
              <rect y="5.5" width="12" height="1" />
            </svg>
          </button>
          <button
            onClick={() => window.electronAPI!.maximize()}
            className="flex h-full w-[46px] items-center justify-center text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
          >
            {isMaximized ? (
              <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="2.5" y="0" width="9.5" height="9.5" rx="0.5" />
                <rect x="0" y="2.5" width="9.5" height="9.5" rx="0.5" />
              </svg>
            ) : (
              <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="0.5" y="0.5" width="11" height="11" rx="0.5" />
              </svg>
            )}
          </button>
          <button
            onClick={() => window.electronAPI!.close()}
            className="flex h-full w-[46px] items-center justify-center text-text-tertiary transition-colors hover:bg-[#e81123] hover:text-white"
            title={t("titlebar.close")}
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
              <path d="M1.05 0.343L0.343 1.05 4.293 5 0.343 8.95l0.707 0.707L5 5.707l3.95 3.95 0.707-0.707L5.707 5l3.95-3.95-0.707-0.707L5 4.293 1.05 0.343z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
