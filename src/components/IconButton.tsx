import type { ReactNode } from "react";

interface IconButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "accent" | "danger";
  size?: "sm" | "md";
  className?: string;
  "data-modal-trigger"?: string;
}

export function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
  tone = "neutral",
  size = "md",
  className = "",
  "data-modal-trigger": modalTrigger
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`ui-icon-button is-${tone} is-${size} ${className}`.trim()}
      aria-label={label}
      title={label}
      data-modal-trigger={modalTrigger}
    >
      {icon}
    </button>
  );
}
