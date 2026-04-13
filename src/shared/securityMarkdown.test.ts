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

  it("allows localhost and LAN images even when remote markdown images are disabled", () => {
    const localhostImage = renderContent("![x](http://127.0.0.1:8188/view?filename=test.png&type=output)", undefined, undefined, {
      sanitizeMarkdown: true,
      allowExternalLinks: false,
      allowRemoteImages: false,
      allowUnsafeUploads: false
    });
    expect(localhostImage).toContain("<img");
    expect(localhostImage).toContain("http://127.0.0.1:8188/view?filename=test.png&amp;type=output");

    const lanImage = renderContent("![x](http://192.168.1.10:8188/view?filename=test.png&type=output)", undefined, undefined, {
      sanitizeMarkdown: true,
      allowExternalLinks: false,
      allowRemoteImages: false,
      allowUnsafeUploads: false
    });
    expect(lanImage).toContain("<img");
    expect(lanImage).toContain("http://192.168.1.10:8188/view?filename=test.png&amp;type=output");
  });
});
