import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-text-secondary">{children}</label>;
}

interface InputFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  onBlur?: () => void;
}

export function InputField({
  value,
  onChange,
  placeholder,
  type = "text",
  onBlur
}: InputFieldProps) {
  const [draftValue, setDraftValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value);
    }
  }, [value, isFocused]);

  return (
    <input
      type={type}
      value={draftValue}
      onFocus={() => setIsFocused(true)}
      onChange={(event) => {
        setDraftValue(event.target.value);
        onChange(event.target.value);
      }}
      placeholder={placeholder}
      onBlur={() => {
        setIsFocused(false);
        onBlur?.();
      }}
      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary"
    />
  );
}

interface SelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}

export function SelectField({ value, onChange, children, disabled = false }: SelectFieldProps) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
    >
      {children}
    </select>
  );
}

interface StatusMessageProps {
  text: string;
  variant?: "info" | "success" | "error";
}

export function StatusMessage({ text, variant = "info" }: StatusMessageProps) {
  if (!text) return null;

  const styles = {
    info: "border-border-subtle bg-bg-primary text-text-secondary",
    success: "border-success-border bg-success-subtle text-success",
    error: "border-danger-border bg-danger-subtle text-danger"
  };

  return <div className={`rounded-lg border px-3 py-2 text-xs ${styles[variant]}`}>{text}</div>;
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false
}: ToggleSwitchProps) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <div className="toggle-track">
        <div className="toggle-thumb" />
      </div>
    </label>
  );
}
