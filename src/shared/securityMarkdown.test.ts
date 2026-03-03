import { describe, expect, it } from "vitest";
import { renderContent } from "../features/chat/utils";

describe("markdown security rendering", () => {
  it("escapes raw html when sanitization is enabled", () => {
    const html = renderContent("<img src=x onerror=alert(1)>", undefined, undefined, {
      sanitizeMarkdown: true,
      allowExternalLinks: false,
      allowRemoteImages: false,
      allowUnsafeUploads: false
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("strips javascript links", () => {
    const html = renderContent("[x](javascript:alert(1))", undefined, undefined, {
      sanitizeMarkdown: true,
      allowExternalLinks: true,
      allowRemoteImages: false,
      allowUnsafeUploads: false
    });
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("<a ");
  });

  it("blocks remote images by default policy", () => {
    const blocked = renderContent("![x](https://example.com/x.png)", undefined, undefined, {
      sanitizeMarkdown: true,
      allowExternalLinks: false,
      allowRemoteImages: false,
      allowUnsafeUploads: false
    });
    expect(blocked).not.toContain("<img");

    const allowed = renderContent("![x](https://example.com/x.png)", undefined, undefined, {
      sanitizeMarkdown: true,
      allowExternalLinks: false,
      allowRemoteImages: true,
      allowUnsafeUploads: false
    });
    expect(allowed).toContain("<img");
    expect(allowed).toContain("https://example.com/x.png");
  });
});
