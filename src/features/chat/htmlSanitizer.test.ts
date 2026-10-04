import { describe, expect, it } from "vitest";
import { sanitizeHtmlFragment, type HtmlUrlPolicy } from "./htmlSanitizer";

const policy: HtmlUrlPolicy = {
  sanitizeLinkUrl: (raw) => (/^https:\/\/ok\.example\//.test(raw) || raw.startsWith("/") ? raw : null),
  sanitizeImageUrl: (raw) => (raw.startsWith("/api/") ? raw : null)
};

describe("sanitizeHtmlFragment", () => {
  it("keeps formatting tags and safe attributes", () => {
    expect(sanitizeHtmlFragment('<span class="note" style="color: red">Hi</span><br/>', policy))
      .toBe('<span class="note" style="color: red">Hi</span><br>');
    expect(sanitizeHtmlFragment("<details open><summary>More</summary><b>x</b></details>", policy))
      .toBe('<details open=""><summary>More</summary><b>x</b></details>');
  });

  it("drops scripts, frames and other active content together with their bodies", () => {
    const html = sanitizeHtmlFragment(
      '<script>alert(1)</script><iframe srcdoc="<script src=/x.js></script>"></iframe><style>body{background:url(//t)}</style><svg onload=alert(1)><circle/></svg>ok',
      policy
    );
    expect(html).toBe("ok");
  });

  it("strips event handlers and unsafe URLs, including entity-encoded schemes", () => {
    expect(sanitizeHtmlFragment('<img src="/api/uploads/a.png" onerror="alert(1)">', policy))
      .toBe('<img src="/api/uploads/a.png" loading="lazy" referrerpolicy="no-referrer">');
    expect(sanitizeHtmlFragment('<img src="https://tracker.example/p.gif">', policy)).toBe("");
    expect(sanitizeHtmlFragment('<a href="jav&#x61;script:alert(1)">x</a>', policy)).toBe("<a target=\"_blank\" rel=\"noopener noreferrer nofollow\">x</a>");
    expect(sanitizeHtmlFragment('<a href="https://ok.example/page">x</a>', policy))
      .toBe('<a href="https://ok.example/page" target="_blank" rel="noopener noreferrer nofollow">x</a>');
  });

  it("removes CSS that loads resources or overlays the app", () => {
    expect(sanitizeHtmlFragment('<div style="background: url(https://t.example/x); color: blue; position: fixed">x</div>', policy))
      .toBe('<div style="color: blue">x</div>');
    expect(sanitizeHtmlFragment('<div style="background:u\\72l(https://t)">x</div>', policy)).toBe("<div>x</div>");
  });

  it("escapes unknown tags, forms and malformed markup instead of passing them through", () => {
    expect(sanitizeHtmlFragment('<form action="https://evil"><input name=x></form>', policy)).toBe("");
    expect(sanitizeHtmlFragment('<img src=x onerror=alert(1)//', policy)).toBe("&lt;img src=x onerror=alert(1)//");
    expect(sanitizeHtmlFragment("<!-- hidden --><b>x</b>", policy)).toBe("<b>x</b>");
    expect(sanitizeHtmlFragment('<b title="&quot;><script>">x</b>', policy)).toBe('<b title="&quot;&gt;&lt;script&gt;">x</b>');
  });
});
