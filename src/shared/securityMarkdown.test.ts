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

  it("allows loopback images but treats LAN hosts as remote when remote markdown images are disabled", () => {
    const strict = {
      sanitizeMarkdown: true,
      allowExternalLinks: false,
      allowRemoteImages: false,
      allowUnsafeUploads: false
    };
    const localhostImage = renderContent("![x](http://127.0.0.1:8188/view?filename=test.png&type=output)", undefined, undefined, strict);
    expect(localhostImage).toContain("<img");
    expect(localhostImage).toContain("http://127.0.0.1:8188/view?filename=test.png&amp;type=output");

    // LAN images could fire blind GET requests at routers/NAS from model output.
    const lanUrl = "![x](http://192.168.1.10:8188/view?filename=test.png&type=output)";
    expect(renderContent(lanUrl, undefined, undefined, strict)).not.toContain("<img");
    expect(renderContent(lanUrl, undefined, undefined, { ...strict, allowRemoteImages: true }))
      .toContain("http://192.168.1.10:8188/view?filename=test.png&amp;type=output");
  });
});
