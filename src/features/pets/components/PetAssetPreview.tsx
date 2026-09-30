import { AvatarBadge } from "../../../components/AvatarBadge";

export function isPetVideoAsset(url: string | null | undefined) {
  const value = String(url || "").trim();
  return /^data:video\//i.test(value) || /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value);
}

/** Renders a pet the way the desktop window does: sprite sheet, video, image, or monogram. */
export function PetAssetPreview({
  name,
  src,
  spriteSheetUrl,
  className,
  fallbackClassName = ""
}: {
  name: string;
  src?: string | null;
  spriteSheetUrl?: string | null;
  className: string;
  fallbackClassName?: string;
}) {
  if (spriteSheetUrl) {
    return (
      <div
        aria-label={name}
        className={`${className} bg-contain bg-no-repeat`}
        style={{
          backgroundImage: `url("${spriteSheetUrl}")`,
          backgroundSize: "800% 900%",
          backgroundPosition: "0 0"
        }}
      />
    );
  }

  if (isPetVideoAsset(src)) {
    return <video src={src || undefined} className={`${className} object-cover`} muted loop autoPlay playsInline />;
  }

  return <AvatarBadge name={name} src={src} className={className} fallbackClassName={fallbackClassName} />;
}
