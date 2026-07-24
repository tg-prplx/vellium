const DISABLED_FEATURES = [
  "camera=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "midi=()"
];

export function buildPermissionsPolicy(pathname: string): string {
  const microphonePolicy = pathname.startsWith("/api/")
    ? "microphone=()"
    : "microphone=(self)";
  return [DISABLED_FEATURES[0], microphonePolicy, ...DISABLED_FEATURES.slice(1)].join(", ");
}
