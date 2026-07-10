import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../shared/i18n";

export const WELCOME_TOUR_STORAGE_KEY = "vellium:welcome-tour:v1";
export const WELCOME_TOUR_START_EVENT = "welcome-tour-start";

type TourNavigation = {
  tab?: string;
  settingsCategory?: string;
  settingsSectionId?: string;
};

type WelcomeTourProps = {
  open: boolean;
  onClose: () => void;
  onNavigate: (navigation: TourNavigation) => void;
};

type TourStep = TourNavigation & {
  id: string;
  title: string;
  description: string;
  target?: string;
  icon: string;
};

type TargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatLabel(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

export function hasCompletedWelcomeTour() {
  try {
    return window.localStorage.getItem(WELCOME_TOUR_STORAGE_KEY) === "completed";
  } catch {
    return false;
  }
}

export function markWelcomeTourCompleted() {
  try {
    window.localStorage.setItem(WELCOME_TOUR_STORAGE_KEY, "completed");
  } catch {
    // The tour still works when storage is disabled; it will simply appear next launch.
  }
}

export function resetWelcomeTourProgress() {
  try {
    window.localStorage.removeItem(WELCOME_TOUR_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

export function WelcomeTour({ open, onClose, onNavigate }: WelcomeTourProps) {
  const { t, locale } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [workspaceTop, setWorkspaceTop] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const steps = useMemo<TourStep[]>(() => [
    {
      id: "welcome",
      title: t("tour.welcomeTitle"),
      description: t("tour.welcomeDesc"),
      icon: "M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3zm6 11l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"
    },
    {
      id: "chat",
      title: t("tour.chatTitle"),
      description: t("tour.chatDesc"),
      tab: "chat",
      target: ".chat-simple-center-panel",
      icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4-4 7-9 7a11 11 0 01-4-.75L3 19l1.2-3.2A7 7 0 013 12c0-4 4-7 9-7s9 3 9 7z"
    },
    {
      id: "characters",
      title: t("tour.charactersTitle"),
      description: t("tour.charactersDesc"),
      tab: "characters",
      target: ".app-main .three-panel-layout > aside",
      icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    },
    {
      id: "forge",
      title: t("tour.forgeTitle"),
      description: t("tour.forgeDesc"),
      tab: "character-forge",
      target: ".charforge-workbench",
      icon: "M12 3v2m6.4.6L17 7M21 12h-2M5 12H3m4-5L5.6 5.6M9 18h6m-5 3h4m-5.5-7.5a5 5 0 117 0c-.9.7-1.5 1.7-1.5 2.5h-4c0-.8-.6-1.8-1.5-2.5z"
    },
    {
      id: "knowledge",
      title: t("tour.knowledgeTitle"),
      description: t("tour.knowledgeDesc"),
      tab: "knowledge",
      target: ".app-main .three-panel-layout > aside",
      icon: "M3 7a2 2 0 012-2h4.5a2 2 0 011.6.8l1.8 2.4H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
    },
    {
      id: "settings",
      title: t("tour.settingsTitle"),
      description: t("tour.settingsDesc"),
      tab: "settings",
      settingsCategory: "interface",
      settingsSectionId: "settings-general",
      target: ".settings-sidebar",
      icon: "M10.3 4.3c.4-1.8 2.9-1.8 3.4 0a1.7 1.7 0 002.6 1.1c1.5-.9 3.3.8 2.3 2.3a1.7 1.7 0 001.1 2.6c1.8.4 1.8 2.9 0 3.4a1.7 1.7 0 00-1.1 2.6c.9 1.5-.8 3.3-2.3 2.3a1.7 1.7 0 00-2.6 1.1c-.4 1.8-2.9 1.8-3.4 0a1.7 1.7 0 00-2.6-1.1c-1.5.9-3.3-.8-2.3-2.3a1.7 1.7 0 00-1.1-2.6c-1.8-.4-1.8-2.9 0-3.4a1.7 1.7 0 001.1-2.6c-.9-1.5.8-3.3 2.3-2.3a1.7 1.7 0 002.6-1.1zM12 15a3 3 0 100-6 3 3 0 000 6z"
    },
    {
      id: "personalize",
      title: t("tour.personalizeTitle"),
      description: t("tour.personalizeDesc"),
      tab: "settings",
      settingsCategory: "interface",
      settingsSectionId: "settings-wallpaper",
      target: "#settings-wallpaper",
      icon: "M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2 1.6-1.6a2 2 0 012.8 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2zM15 8h.01"
    },
    {
      id: "done",
      title: t("tour.doneTitle"),
      description: t("tour.doneDesc"),
      icon: "M5 13l4 4L19 7"
    }
  ], [locale]);

  const step = steps[stepIndex] ?? steps[0];
  const isLastStep = stepIndex === steps.length - 1;

  useLayoutEffect(() => {
    if (!open) return;
    const syncWorkspaceTop = () => {
      const toolbar = document.querySelector<HTMLElement>(".app-shell > .app-header");
      setWorkspaceTop(toolbar ? Math.max(0, Math.round(toolbar.getBoundingClientRect().bottom)) : 0);
    };
    syncWorkspaceTop();
    window.addEventListener("resize", syncWorkspaceTop);
    return () => window.removeEventListener("resize", syncWorkspaceTop);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    onNavigate(step);
    setTargetRect(null);

    let frame = 0;
    const syncTarget = () => {
      frame = window.requestAnimationFrame(() => {
        const element = step.target
          ? Array.from(document.querySelectorAll<HTMLElement>(step.target)).find((candidate) => {
              const candidateRect = candidate.getBoundingClientRect();
              return candidateRect.width > 1 && candidateRect.height > 1;
            }) ?? null
          : null;
        if (!element) {
          setTargetRect(null);
          return;
        }
        const rect = element.getBoundingClientRect();
        const padding = 8;
        setTargetRect({
          top: Math.max(workspaceTop + 6, rect.top - padding),
          left: Math.max(6, rect.left - padding),
          width: Math.min(window.innerWidth - 12, rect.width + padding * 2),
          height: Math.min(window.innerHeight - workspaceTop - 12, rect.height + padding * 2)
        });
      });
    };

    syncTarget();
    const shortTimer = window.setTimeout(syncTarget, 90);
    const loadTimer = window.setTimeout(syncTarget, 320);
    window.addEventListener("resize", syncTarget);
    window.addEventListener("scroll", syncTarget, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(shortTimer);
      window.clearTimeout(loadTimer);
      window.removeEventListener("resize", syncTarget);
      window.removeEventListener("scroll", syncTarget, true);
    };
  }, [open, step, onNavigate, workspaceTop]);

  useEffect(() => {
    if (!open) return;
    surfaceRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        markWelcomeTourCompleted();
        onClose();
      } else if (event.key === "ArrowRight" && !isLastStep) {
        event.preventDefault();
        setStepIndex((current) => Math.min(steps.length - 1, current + 1));
      } else if (event.key === "ArrowLeft" && stepIndex > 0) {
        event.preventDefault();
        setStepIndex((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLastStep, onClose, open, stepIndex, steps.length]);

  if (!open) return null;

  const cardWidth = Math.min(420, window.innerWidth - 28);
  const cardHeightEstimate = 290;
  const targetBottom = targetRect ? targetRect.top + targetRect.height : 0;
  const shouldPlaceAbove = Boolean(targetRect && targetBottom + cardHeightEstimate > window.innerHeight - 12);
  const cardLeft = targetRect
    ? clamp(targetRect.left + targetRect.width / 2 - cardWidth / 2, 14, window.innerWidth - cardWidth - 14)
    : (window.innerWidth - cardWidth) / 2;
  const cardTop = targetRect
    ? shouldPlaceAbove
      ? Math.max(workspaceTop + 14, targetRect.top - cardHeightEstimate - 14)
      : Math.min(window.innerHeight - cardHeightEstimate - 14, targetBottom + 14)
    : workspaceTop + Math.max(20, (window.innerHeight - workspaceTop - cardHeightEstimate) / 2);
  const cardStyle = {
    width: cardWidth,
    left: cardLeft,
    top: cardTop - workspaceTop,
    "--tour-origin-x": targetRect ? `${clamp(((targetRect.left + targetRect.width / 2 - cardLeft) / cardWidth) * 100, 8, 92)}%` : "50%"
  } as CSSProperties;

  const finish = () => {
    markWelcomeTourCompleted();
    onNavigate({ tab: "chat" });
    onClose();
  };

  const skip = () => {
    markWelcomeTourCompleted();
    onClose();
  };

  return createPortal(
    <div className="welcome-tour-layer" style={{ top: workspaceTop }}>
      {targetRect ? (
        <div
          className="welcome-tour-spotlight"
          style={{
            top: targetRect.top - workspaceTop,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height
          }}
        />
      ) : <div className="welcome-tour-dimmer" />}

      <div
        key={step.id}
        ref={surfaceRef}
        className="welcome-tour-card"
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        tabIndex={-1}
      >
        <div className="welcome-tour-card-accent" />
        <header className="welcome-tour-card-header">
          <div className="welcome-tour-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={step.icon} />
            </svg>
          </div>
          <button type="button" className="welcome-tour-skip" onClick={skip}>{t("tour.skip")}</button>
        </header>

        <div className="welcome-tour-copy">
          <div className="welcome-tour-kicker">{formatLabel(t("tour.step"), { current: stepIndex + 1, total: steps.length })}</div>
          <h2>{step.title}</h2>
          <p>{step.description}</p>
        </div>

        <div className="welcome-tour-progress" aria-label={t("tour.progress")}>
          {steps.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={index === stepIndex ? "is-active" : index < stepIndex ? "is-complete" : ""}
              onClick={() => setStepIndex(index)}
              aria-label={formatLabel(t("tour.goToStep"), { step: index + 1 })}
              aria-current={index === stepIndex ? "step" : undefined}
            />
          ))}
        </div>

        <footer className="welcome-tour-actions">
          <button
            type="button"
            className="welcome-tour-back"
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
            disabled={stepIndex === 0}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" /></svg>
            {t("tour.back")}
          </button>
          <button
            type="button"
            className="welcome-tour-next"
            onClick={isLastStep ? finish : () => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}
          >
            {isLastStep ? t("tour.finish") : t("tour.next")}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" /></svg>
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
