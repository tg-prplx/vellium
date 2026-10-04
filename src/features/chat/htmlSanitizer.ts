/**
 * Allowlist HTML sanitizer for model/card HTML shown when strict markdown
 * sanitization is disabled. It never passes input through: allowed tags and
 * attributes are re-serialized with escaped values and everything else is
 * emitted as escaped text, so a parsing mismatch with the browser can only
 * produce visible text, never active markup.
 */

export interface HtmlUrlPolicy {
  sanitizeLinkUrl: (raw: string) => string | null;
  sanitizeImageUrl: (raw: string) => string | null;
}

const ALLOWED_TAGS = new Set([
  "a", "abbr", "article", "b", "big", "blockquote", "br", "caption", "center", "cite", "code",
  "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption",
  "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img",
  "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp",
  "section", "small", "span", "strike", "strong", "sub", "summary", "sup", "table", "tbody",
  "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "var", "wbr"
]);
const VOID_TAGS = new Set(["br", "col", "hr", "img", "wbr"]);
// Elements whose content is code or a nested document; drop them together with their content.
const DROP_WITH_CONTENT_TAGS = new Set([
  "script", "style", "template", "iframe", "frame", "frameset", "object", "embed", "noscript",
  "noembed", "noframes", "textarea", "title", "xmp", "plaintext", "svg", "math", "select", "option"
]);
const GLOBAL_ATTRIBUTES = new Set(["class", "title", "lang", "dir", "align", "style"]);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height"]),
  font: new Set(["color", "size", "face"]),
  td: new Set(["colspan", "rowspan", "valign", "width"]),
  th: new Set(["colspan", "rowspan", "valign", "width", "scope"]),
  col: new Set(["span", "width"]),
  colgroup: new Set(["span", "width"]),
  ol: new Set(["start", "type", "reversed"]),
  ul: new Set(["type"]),
  li: new Set(["value"]),
  details: new Set(["open"]),
  table: new Set(["width", "border", "cellpadding", "cellspacing"])
};
// CSS that loads remote resources, runs legacy script hooks, or escapes the message bubble.
const UNSAFE_STYLE_VALUE = /url\s*\(|image-set\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding|javascript:|\\/i;
const UNSAFE_STYLE_PROPERTIES = new Set(["position", "inset", "z-index"]);

const TAG_PATTERN = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE_PATTERN = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_match, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(quot|apos|lt|gt|amp|colon|tab|newline);/gi, (_match, name: string) => ({
      quot: "\"", apos: "'", lt: "<", gt: ">", amp: "&", colon: ":", tab: "\t", newline: "\n"
    })[name.toLowerCase()] ?? "");
}

function safeFromCodePoint(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "";
  return String.fromCodePoint(codePoint);
}

function sanitizeStyle(raw: string): string {
  return raw
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator <= 0) return false;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      return !UNSAFE_STYLE_PROPERTIES.has(property) && !UNSAFE_STYLE_VALUE.test(declaration);
    })
    .join("; ");
}

function sanitizeAttribute(tag: string, name: string, rawValue: string, policy: HtmlUrlPolicy): string | null {
  const value = decodeEntities(rawValue).replace(/[\u0000-\u001f\u007f]/g, "");
  if (name === "href") return policy.sanitizeLinkUrl(value);
  if (name === "src") return tag === "img" ? policy.sanitizeImageUrl(value) : null;
  if (name === "style") {
    const style = sanitizeStyle(value);
    return style || null;
  }
  return value.slice(0, 500);
}

function serializeTag(tag: string, rawAttributes: string, policy: HtmlUrlPolicy): string | null {
  const allowedForTag = TAG_ATTRIBUTES[tag];
  const attributes: string[] = [];
  const seen = new Set<string>();
  for (const match of rawAttributes.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    if (seen.has(name) || (!GLOBAL_ATTRIBUTES.has(name) && !allowedForTag?.has(name))) continue;
    seen.add(name);
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    const value = sanitizeAttribute(tag, name, rawValue, policy);
    if (value === null) continue;
    attributes.push(`${name}="${escapeHtml(value)}"`);
  }
  if (tag === "img" && !attributes.some((attribute) => attribute.startsWith("src="))) return null;
  if (tag === "a") attributes.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
  if (tag === "img") attributes.push('loading="lazy"', 'referrerpolicy="no-referrer"');
  return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>`;
}

export function sanitizeHtmlFragment(html: string, policy: HtmlUrlPolicy): string {
  const source = String(html || "").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  let output = "";
  let cursor = 0;
  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(source)) !== null) {
    output += escapeHtml(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const isClosing = match[1] === "/";
    const tag = match[2].toLowerCase();

    if (DROP_WITH_CONTENT_TAGS.has(tag)) {
      if (!isClosing && match[4] !== "/") {
        const closing = new RegExp(`</${tag}\\s*>`, "i");
        const rest = source.slice(cursor);
        const closeMatch = closing.exec(rest);
        cursor = closeMatch ? cursor + closeMatch.index + closeMatch[0].length : source.length;
        TAG_PATTERN.lastIndex = cursor;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (isClosing) {
      if (!VOID_TAGS.has(tag)) output += `</${tag}>`;
      continue;
    }
    output += serializeTag(tag, match[3] || "", policy) ?? "";
  }
  output += escapeHtml(source.slice(cursor));
  return output;
}
