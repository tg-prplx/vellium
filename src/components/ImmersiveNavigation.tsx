import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../shared/i18n";

export function ImmersiveNavigation({ active, children }: { active: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const visibleRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const dismissHint = useCallback(() => {
    setHintVisible(false);
    try { window.localStorage.setItem("vellium:novel-navigation-hint:v1", "seen"); } catch { /* Storage can be unavailable. */ }
  }, []);
  useEffect(() => {
    if (!active) { setHintVisible(false); return; }
    let seen = false;
    try { seen = window.localStorage.getItem("vellium:novel-navigation-hint:v1") === "seen"; } catch { /* Show the hint for this visit. */ }
    if (!seen) setHintVisible(true);
    const repeatHint = () => setHintVisible(true);
    window.addEventListener("vellium:novel-navigation-help", repeatHint);
    return () => window.removeEventListener("vellium:novel-navigation-help", repeatHint);
  }, [active]);
  const show = useCallback(() => {
    clearTimer();
    if (!visibleRef.current) { dismissHint(); visibleRef.current = true; setVisible(true); }
  }, [clearTimer, dismissHint]);
  const close = useCallback(() => {
    clearTimer(); visibleRef.current = false; setVisible(false);
  }, [clearTimer]);
  const hide = useCallback(() => {
    if (timer.current !== null || !visibleRef.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && shell.current?.contains(focused) && focused.matches(":focus-visible")) return;
      visibleRef.current = false; setVisible(false);
    }, 180);
  }, []);

  useEffect(() => {
    close();
    if (!active) return;
    // Electron may not emit enter/leave when the title bar slides under a
    // stationary pointer. Use coordinates as well, without polling or updating
    // React state on every pointer move. The final bar bounds remain stable
    // throughout its transform animation.
    const trackPointer = (event: PointerEvent) => {
      const bar = shell.current;
      const workspace = bar?.parentElement;
      if (!bar || !workspace || event.pointerType === "touch") return;
      const bounds = workspace.getBoundingClientRect();
      const withinWidth = event.clientX >= bounds.left && event.clientX <= bounds.right;
      const y = event.clientY - bounds.top;
      if (withinWidth && y >= 0 && y <= 32) { show(); return; }
      if (!visibleRef.current) return;
      if ((withinWidth && y >= 0 && y <= bar.offsetHeight) || (event.target instanceof Node && bar.contains(event.target))) show();
      else hide();
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !shell.current?.contains(target) && !target.closest(".novel-navigation-trigger")) close();
    };
    window.addEventListener("pointermove", trackPointer, { passive: true });
    window.addEventListener("blur", close);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      clearTimer();
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("blur", close);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [active, close, clearTimer, hide, show]);

  return <>
    {active && <button type="button" className="novel-navigation-trigger" aria-label={t("novel.showNavigation")} aria-expanded={visible}
      onPointerEnter={show} onFocus={show} onClick={show} style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}><span /></button>}
    <div ref={shell} className={`app-navigation-shell ${active ? "is-immersive" : ""} ${visible ? "is-revealed" : ""}`}
      onPointerEnter={active ? show : undefined} onPointerLeave={active ? hide : undefined}
      onFocusCapture={active ? show : undefined} onBlurCapture={(e) => { if (active && !e.currentTarget.contains(e.relatedTarget as Node | null)) hide(); }}
      onKeyDown={(e) => { if (active && e.key === "Escape") close(); }}>
      {children}
    </div>
    {active && hintVisible && !visible && <aside className="novel-navigation-guide" role="status" aria-label={t("novel.guide.title")}>
      <svg className="novel-guide-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 20V4m-6 6 6-6 6 6" /></svg>
      <h2>{t("novel.guide.title")}</h2>
      <p className="novel-guide-pointer">{t("novel.guide.pointer")}</p><p className="novel-guide-touch">{t("novel.guide.touch")}</p>
      <div><button type="button" className="novel-guide-show" onClick={show}>{t("novel.guide.show")}</button><button type="button" onClick={dismissHint}>{t("novel.guide.dismiss")}</button></div>
    </aside>}
  </>;
}
