import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type ModalSize = "sm" | "md" | "lg" | "xl" | "viewport";

interface ModalShellProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  icon?: ReactNode;
  eyebrow?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  originId?: string;
  closeDisabled?: boolean;
  bodyClassName?: string;
  layerClassName?: string;
  surfaceClassName?: string;
  surfaceStyle?: CSSProperties;
}

let bodyLockDepth = 0;
let previousBodyOverflow = "";
const modalStack: Array<{ id: symbol; surface: HTMLElement }> = [];

function syncModalStack() {
  modalStack.sort((left, right) => {
    const leftZ = Number.parseInt(getComputedStyle(left.surface.parentElement || left.surface).zIndex, 10) || 0;
    const rightZ = Number.parseInt(getComputedStyle(right.surface.parentElement || right.surface).zIndex, 10) || 0;
    return leftZ - rightZ;
  });
  const topId = modalStack[modalStack.length - 1]?.id;
  for (const entry of modalStack) {
    if (entry.id === topId) {
      entry.surface.removeAttribute("aria-hidden");
      entry.surface.removeAttribute("inert");
    } else {
      entry.surface.setAttribute("aria-hidden", "true");
      entry.surface.setAttribute("inert", "");
    }
  }
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

export function ModalShell({
  title,
  description,
  children,
  onClose,
  closeLabel,
  icon,
  eyebrow,
  headerActions,
  footer,
  size = "md",
  originId,
  closeDisabled = false,
  bodyClassName = "",
  layerClassName = "",
  surfaceClassName = "",
  surfaceStyle
}: ModalShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const modalIdRef = useRef(Symbol("vellium-modal"));
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });

  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useLayoutEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!originId) return;
    const trigger = document.querySelector<HTMLElement>(`[data-modal-trigger="${originId}"]`);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setOrigin({
      x: Math.max(8, Math.min(92, ((rect.left + rect.width / 2) / window.innerWidth) * 100)),
      y: Math.max(8, Math.min(92, ((rect.top + rect.height / 2) / window.innerHeight) * 100))
    });
  }, [originId]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (bodyLockDepth === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    bodyLockDepth += 1;
    const modalId = modalIdRef.current;

    modalStack.push({ id: modalId, surface });
    syncModalStack();
    const preferredFocus = surface.querySelector<HTMLElement>("[data-modal-autofocus], [autofocus]");
    (preferredFocus || surface).focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1]?.id !== modalId) return;
      if (event.key === "Escape") {
        if (!closeDisabledRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.offsetParent !== null && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        surface.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const stackIndex = modalStack.findIndex((entry) => entry.id === modalId);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      syncModalStack();
      bodyLockDepth = Math.max(0, bodyLockDepth - 1);
      if (bodyLockDepth === 0) document.body.style.overflow = previousBodyOverflow;
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, []);

  const style = {
    "--modal-origin-x": `${origin.x}%`,
    "--modal-origin-y": `${origin.y}%`,
    ...surfaceStyle
  } as CSSProperties;

  return (
    <div
      className={`vellium-modal-layer ${layerClassName}`.trim()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={closeDisabled || undefined}
        tabIndex={-1}
        className={`vellium-modal-surface vellium-modal-${size} ${surfaceClassName}`.trim()}
        style={style}
      >
        <header className="vellium-modal-header">
          <div className="vellium-modal-heading">
            {icon ? <span className="vellium-modal-icon" aria-hidden="true">{icon}</span> : null}
            <div className="min-w-0">
              {eyebrow ? <div className="vellium-modal-eyebrow">{eyebrow}</div> : null}
              <h2 id={titleId} className="vellium-modal-title">{title}</h2>
              {description ? <p id={descriptionId} className="vellium-modal-description">{description}</p> : null}
            </div>
          </div>
          <div className="vellium-modal-header-actions">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              disabled={closeDisabled}
              className="vellium-modal-close"
              aria-label={closeLabel}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>
        <div className={`vellium-modal-body ${bodyClassName}`.trim()}>{children}</div>
        {footer ? <footer className="vellium-modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
