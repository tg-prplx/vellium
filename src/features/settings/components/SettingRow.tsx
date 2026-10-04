import type { ReactNode } from "react";

/**
 * Settings layout primitives. A group is one container with a quiet header; inside it every
 * setting is a row: what it is and why on the left, the control on the right. Large inputs
 * (prompts, long text) use `wide` and sit under their label instead.
 */
export function SettingsGroup({ id, title, description, actions, tone, children }: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section id={id} className={`settings-section settings-group scroll-mt-24${tone === "danger" ? " border-danger-border" : ""}`}>
      <header className="settings-group-header">
        <div className="min-w-0">
          <h3 className="settings-section-title">{title}</h3>
          {description ? <p className="settings-section-desc">{description}</p> : null}
        </div>
        {actions ? <div className="settings-group-actions">{actions}</div> : null}
      </header>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

export function SettingRow({ label, description, children, wide = false, toggle = false, disabled = false, aside }: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Control spans the full row under the label (textareas, editors, lists). */
  wide?: boolean;
  /** Control is a switch, kept compact at the right edge. */
  toggle?: boolean;
  disabled?: boolean;
  /** Small control next to the label, e.g. "Load models". */
  aside?: ReactNode;
}) {
  return (
    <div className={`setting-row${wide ? " is-wide" : ""}${toggle ? " is-toggle" : ""}${disabled ? " is-disabled" : ""}`}>
      <div className="setting-row-copy">
        <div className="setting-row-label">
          <span>{label}</span>
          {aside}
        </div>
        {description ? <div className="setting-row-desc">{description}</div> : null}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

/** Range input with its current value, sized for a settings row. */
export function SettingSlider({ value, min, max, step, format, onChange, ariaLabel }: {
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="setting-slider">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))} />
      <output>{format ? format(value) : value.toFixed(2)}</output>
    </div>
  );
}
