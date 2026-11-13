import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Reader toolbar pieces. Icons are 24-unit stroke paths, like the rest of the app. */
const ICONS: Record<string, string> = {
  back: "M15 18l-6-6 6-6",
  auto: "M5 4l14 8-14 8z",
  voice: "M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13",
  replay: "M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5",
  stop: "M7 7h10v10H7z",
  journal: "M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1zM12 6v14",
  memory: "M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6M21 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8",
  bookmark: "M6 4h12v17l-6-4-6 4z",
  hide: "M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.5 9.5 0 0121.5 12a14 14 0 01-2.2 3.3M6.6 6.6A14 14 0 002.5 12a9.5 9.5 0 0012.9 5.4",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  next: "M9 6l6 6-6 6"
};
export function NovelIcon({ name }: { name: keyof typeof ICONS | string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

/** A toolbar button. `label` is always the accessible name; it is shown as
 * text unless `iconOnly`, and hidden on narrow screens unless `keepLabel`. */
export function NovelControl({ icon, label, onClick, disabled, pressed, iconOnly, title }: {
  icon: string; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; iconOnly?: boolean; title?: string;
}) {
  return <button type="button" className={`novel-control ${iconOnly ? "is-icon" : ""}`} onClick={onClick} disabled={disabled}
    aria-pressed={pressed} aria-label={label} title={title || label}>
    <NovelIcon name={icon} />{!iconOnly && <span className="novel-control-label">{label}</span>}
  </button>;
}

/** Overflow menu for rarer actions. The panel is portalled to <body> and fixed
 * to the button: the reading surface scrolls, and an animated ancestor would
 * otherwise clip a fixed child. It stays mounted while closed so dialogs opened
 * from it survive. Closes on outside click, Escape, or after an item is chosen. */
export function NovelMoreMenu({ label, children }: { label: string; children: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const position = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 240, left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    setPlace({ left, bottom: window.innerHeight - rect.top + 8, width });
  };
  useEffect(() => {
    if (!open) return;
    position();
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key !== "Escape") return; event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); };
    window.addEventListener("resize", position);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("resize", position); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  return <div className="novel-more-menu">
    <button ref={trigger} type="button" className="novel-control is-icon" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><NovelIcon name="more" /></button>
    {createPortal(<div ref={panel} className="novel-more-panel" role="menu" hidden={!open} style={place}
      onClick={(event) => { if ((event.target as HTMLElement).closest("button")) setOpen(false); }}>{children}</div>, document.body)}
  </div>;
}
