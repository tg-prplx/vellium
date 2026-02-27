import type { ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  action?: ReactNode;
}

export function CollapsibleSection({ title, collapsed, onToggle, children, action }: CollapsibleSectionProps) {
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-primary">
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          <svg
            className={`h-3 w-3 text-text-tertiary transition-transform ${collapsed ? "-rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{title}</span>
        </button>
        {action}
      </div>
      {!collapsed && (
        <div className="border-t border-border-subtle px-2.5 py-2">
          {children}
        </div>
      )}
    </section>
  );
}
