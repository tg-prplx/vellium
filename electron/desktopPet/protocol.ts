import { protocol, type Session } from "electron";

const DESKTOP_PET_SCHEME = "vellium-pet";
const DESKTOP_PET_HOST = "desktop";

export function registerDesktopPetScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: DESKTOP_PET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false }
  }]);
}

export function buildDesktopPetPageUrl(token: string) {
  return `${DESKTOP_PET_SCHEME}://${DESKTOP_PET_HOST}/index.html?token=${encodeURIComponent(token)}`;
}

export function isDesktopPetPageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${DESKTOP_PET_SCHEME}:` && url.hostname === DESKTOP_PET_HOST && url.pathname === "/index.html";
  } catch {
    return false;
  }
}

export function installDesktopPetProtocol(session: Session, resolveHtml: (token: string) => string | null) {
  session.protocol.handle(DESKTOP_PET_SCHEME, (request) => {
    if (request.method !== "GET" || !isDesktopPetPageUrl(request.url)) {
      return new Response("Not found", { status: 404 });
    }
    const token = new URL(request.url).searchParams.get("token") || "";
    const html = resolveHtml(token);
    return html
      ? new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })
      : new Response("Not found", { status: 404 });
  });
}
