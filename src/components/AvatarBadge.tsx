interface AvatarBadgeProps {
  name: string;
  src?: string | null;
  alt?: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}

function joinClasses(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function AvatarBadge({
  name,
  src,
  alt = "",
  className = "",
  imageClassName = "",
  fallbackClassName = ""
}: AvatarBadgeProps) {
  const label = String(name || "?").trim() || "?";
  const initial = label.charAt(0).toUpperCase();

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={joinClasses(className, "object-cover", imageClassName)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={joinClasses("flex items-center justify-center", className, fallbackClassName)}
    >
      {initial}
    </span>
  );
}
