import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren, type ReactNode } from "react";

type MobilePanel = "left" | "center" | "right";

type MobilePanelTabs = {
  left: string;
  center: string;
  right?: string;
  ariaLabel?: string;
};

export function ThreePanelLayout({
  left,
  center,
  right,
  layout = "three",
  hideRight = false,
  className = "",
  leftClassName = "",
  centerClassName = "",
  rightClassName = "",
  leftInert = false,
  rightInert = false,
  threeColumnLayoutClassName = "xl:grid-cols-[272px_minmax(480px,1fr)_320px]",
  twoColumnLayoutClassName = "xl:grid-cols-[272px_minmax(480px,1fr)]",
  mobileTabs,
  mobileSelectionKey
}: {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  layout?: "three" | "center";
  hideRight?: boolean;
  className?: string;
  leftClassName?: string;
  centerClassName?: string;
  rightClassName?: string;
  leftInert?: boolean;
  rightInert?: boolean;
  threeColumnLayoutClassName?: string;
  twoColumnLayoutClassName?: string;
  mobileTabs?: MobilePanelTabs;
  mobileSelectionKey?: string | null;
}) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("left");
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const panel = leftPanelRef.current;
    if (!panel) return;
    if (leftInert) panel.setAttribute("inert", "");
    else panel.removeAttribute("inert");
  }, [leftInert]);

  useLayoutEffect(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (rightInert) panel.setAttribute("inert", "");
    else panel.removeAttribute("inert");
  }, [rightInert]);

  useEffect(() => {
    if (mobileTabs && mobileSelectionKey) setMobilePanel("center");
  }, [mobileSelectionKey]);

  const rootClass = `three-panel-layout grid h-full min-w-0 ${className}`.trim();
  const wrapMobileLayout = (layoutNode: ReactNode) => {
    if (!mobileTabs) return layoutNode;
    const tabs: Array<{ id: MobilePanel; label: string }> = [
      { id: "left", label: mobileTabs.left },
      { id: "center", label: mobileTabs.center }
    ];
    if (!hideRight && mobileTabs.right) tabs.push({ id: "right", label: mobileTabs.right });
    return (
      <div className="three-panel-responsive-shell">
        <div className="three-panel-mobile-tabs" role="tablist" aria-label={mobileTabs.ariaLabel || mobileTabs.left}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mobilePanel === tab.id}
              className={mobilePanel === tab.id ? "is-active" : ""}
              onClick={() => setMobilePanel(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {layoutNode}
      </div>
    );
  };

  if (layout === "center") {
    return wrapMobileLayout(
      <div className={`${rootClass} grid-cols-1`} data-mobile-panel={mobileTabs ? "center" : undefined}>
        <section data-mobile-pane="center" className={`panel-shell ui-panel-shell flex min-h-0 min-w-0 flex-col p-4 ${centerClassName}`.trim()}>{center}</section>
      </div>
    );
  }

  if (hideRight) {
    return wrapMobileLayout(
      <div className={`${rootClass} grid-cols-1 gap-4 ${twoColumnLayoutClassName}`.trim()} data-mobile-panel={mobileTabs ? mobilePanel : undefined}>
        <aside ref={leftPanelRef} data-mobile-pane="left" className={`panel-shell ui-panel-shell flex min-h-0 min-w-0 flex-col p-4 ${leftClassName}`.trim()}>{left}</aside>
        <section data-mobile-pane="center" className={`panel-shell ui-panel-shell flex min-h-0 min-w-0 flex-col p-4 ${centerClassName}`.trim()}>{center}</section>
      </div>
    );
  }

  return wrapMobileLayout(
    <div className={`${rootClass} grid-cols-1 gap-4 ${threeColumnLayoutClassName}`.trim()} data-mobile-panel={mobileTabs ? mobilePanel : undefined}>
        <aside ref={leftPanelRef} data-mobile-pane="left" className={`panel-shell ui-panel-shell flex min-h-0 min-w-0 flex-col p-4 ${leftClassName}`.trim()}>{left}</aside>
      <section data-mobile-pane="center" className={`panel-shell ui-panel-shell flex min-h-0 min-w-0 flex-col p-4 ${centerClassName}`.trim()}>{center}</section>
      <aside ref={rightPanelRef} data-mobile-pane="right" aria-hidden={rightInert || undefined} className={`panel-shell ui-panel-shell flex min-h-0 min-w-0 flex-col p-4 ${rightClassName}`.trim()}>{right}</aside>
    </div>
  );
}

export function PanelTitle({ children, action }: PropsWithChildren<{ action?: ReactNode }>) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{children}</h2>
      {action}
    </div>
  );
}

export function Badge({ children, variant = "default" }: PropsWithChildren<{ variant?: "default" | "accent" | "warning" | "danger" | "success" }>) {
  const styles = {
    default: "bg-bg-tertiary text-text-secondary",
    accent: "bg-accent-subtle text-accent",
    warning: "bg-warning-subtle text-warning",
    danger: "bg-danger-subtle text-danger",
    success: "bg-success-subtle text-success"
  };

  return (
    <span className={`badge-pop inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state-float flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="text-sm font-medium text-text-secondary">{title}</div>
      {description && <div className="max-w-[260px] text-xs text-text-tertiary">{description}</div>}
      {action}
    </div>
  );
}
