import type { PropsWithChildren, ReactNode } from "react";

export function ThreePanelLayout({ left, center, right }: { left: ReactNode; center: ReactNode; right: ReactNode }) {
  return (
    <div className="three-panel-layout grid h-full grid-cols-1 gap-4 xl:grid-cols-[272px_minmax(480px,1fr)_320px]">
      <aside className="panel-shell flex min-h-0 flex-col rounded-xl border border-border bg-bg-secondary p-4">{left}</aside>
      <section className="panel-shell flex min-h-0 flex-col rounded-xl border border-border bg-bg-secondary p-4">{center}</section>
      <aside className="panel-shell flex min-h-0 flex-col rounded-xl border border-border bg-bg-secondary p-4">{right}</aside>
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
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="text-sm font-medium text-text-secondary">{title}</div>
      {description && <div className="max-w-[260px] text-xs text-text-tertiary">{description}</div>}
      {action}
    </div>
  );
}
