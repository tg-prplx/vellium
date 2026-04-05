import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";

type CommitMode = "immediate" | "debounced" | "blur";

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-text-secondary">{children}</label>;
}

interface InputFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  onBlur?: () => void;
  commitMode?: CommitMode;
  debounceMs?: number;
  disabled?: boolean;
  className?: string;
  list?: string;
}

export function InputField({
  value,
  onChange,
  placeholder,
  type = "text",
  onBlur,
  commitMode = "immediate",
  debounceMs = 420,
  disabled = false,
  className = "",
  list
}: InputFieldProps) {
  const [draftValue, setDraftValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedValueRef = useRef(value);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value);
    }
  }, [value, isFocused]);

  useEffect(() => {
    lastCommittedValueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function commitValue(nextValue: string) {
    if (nextValue === lastCommittedValueRef.current) return;
    lastCommittedValueRef.current = nextValue;
    onChange(nextValue);
  }

  function scheduleCommit(nextValue: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      commitValue(nextValue);
    }, debounceMs);
  }

  return (
    <input
      type={type}
      list={list}
      value={draftValue}
      disabled={disabled}
      onFocus={() => setIsFocused(true)}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);
        if (commitMode === "immediate") {
          commitValue(nextValue);
        } else if (commitMode === "debounced") {
          scheduleCommit(nextValue);
        }
      }}
      placeholder={placeholder}
      onBlur={() => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        setIsFocused(false);
        if (commitMode !== "immediate") {
          commitValue(draftValue);
        }
        onBlur?.();
      }}
      className={`w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary ${className}`.trim()}
    />
  );
}

interface TextareaFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  onBlur?: () => void;
  commitMode?: CommitMode;
  debounceMs?: number;
  className?: string;
  disabled?: boolean;
}

export function TextareaField({
  value,
  onChange,
  placeholder,
  rows = 4,
  onBlur,
  commitMode = "immediate",
  debounceMs = 420,
  className = "",
  disabled = false
}: TextareaFieldProps) {
  const [draftValue, setDraftValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedValueRef = useRef(value);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value);
    }
  }, [value, isFocused]);

  useEffect(() => {
    lastCommittedValueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function commitValue(nextValue: string) {
    if (nextValue === lastCommittedValueRef.current) return;
    lastCommittedValueRef.current = nextValue;
    onChange(nextValue);
  }

  function scheduleCommit(nextValue: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      commitValue(nextValue);
    }, debounceMs);
  }

  return (
    <textarea
      rows={rows}
      value={draftValue}
      disabled={disabled}
      onFocus={() => setIsFocused(true)}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);
        if (commitMode === "immediate") {
          commitValue(nextValue);
        } else if (commitMode === "debounced") {
          scheduleCommit(nextValue);
        }
      }}
      placeholder={placeholder}
      onBlur={() => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        setIsFocused(false);
        if (commitMode !== "immediate") {
          commitValue(draftValue);
        }
        onBlur?.();
      }}
      className={`w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary ${className}`.trim()}
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
