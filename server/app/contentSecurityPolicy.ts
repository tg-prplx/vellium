export function buildContentSecurityPolicy(publicMode: boolean) {
  const connectSrc = publicMode
    ? "'self'"
    : "'self' http://127.0.0.1:3001 http://localhost:3001";
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' blob: data:",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join("; ");
}
