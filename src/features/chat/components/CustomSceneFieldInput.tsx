import type { CustomInspectorField } from "../../../shared/types/contracts";

interface CustomSceneFieldInputProps {
  field: CustomInspectorField;
  value: string;
  onChange: (value: string) => void;
}

export function CustomSceneFieldInput({
  field,
  value,
  onChange
}: CustomSceneFieldInputProps) {
  if (field.type === "toggle") {
    const checked = value === "true" || value === "1" || value === "yes";
    return (
      <div className="rounded-xl border border-border-subtle bg-bg-secondary/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <label className="block text-[10px] text-text-tertiary">{field.label}</label>
            {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
          </div>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked ? "true" : "false")}
            className="h-4 w-4"
          />
        </div>
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div>
        <label className="mb-1 block text-[10px] text-text-tertiary">{field.label}</label>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
        >
          <option value="">{field.placeholder || "—"}</option>
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
      </div>
    );
  }

  if (field.type === "range") {
    const min = Number.isFinite(field.min) ? Number(field.min) : 0;
    const max = Number.isFinite(field.max) ? Number(field.max) : 100;
    const step = Number.isFinite(field.step) ? Number(field.step) : 1;
    const numericValue = Number(value || field.defaultValue || min);

    return (
      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <label className="text-[10px] text-text-tertiary">{field.label}</label>
          <span className="text-[10px] text-text-tertiary">{Number.isFinite(numericValue) ? numericValue : min}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(numericValue) ? numericValue : min}
          onChange={(event) => onChange(event.target.value)}
          className="w-full"
        />
        {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div>
        <label className="mb-1 block text-[10px] text-text-tertiary">{field.label}</label>
        <textarea
          value={value}
          rows={field.rows || 3}
          placeholder={field.placeholder || ""}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
        />
        {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-[10px] text-text-tertiary">{field.label}</label>
      <input
        value={value}
        placeholder={field.placeholder || ""}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
      />
      {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
    </div>
  );
}
