import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextMeter } from "./ContextMeter";

const render = (props: Partial<Parameters<typeof ContextMeter>[0]> = {}) =>
  renderToStaticMarkup(<ContextMeter onOpen={() => undefined} {...props} />);

describe("ContextMeter", () => {
  it("shows the share of the window used by the last request", () => {
    const html = render({ usedTokens: 2048, windowTokens: 8192, reservedTokens: 1024 });
    expect(html).toContain("25%");
    expect(html).toContain('aria-label="Context usage: 25%"');
    expect(html).not.toMatch(/is-near|is-over/);
  });

  it("marks estimates and warns near or over the budget including the reply reserve", () => {
    expect(render({ usedTokens: 6000, windowTokens: 8192, reservedTokens: 1024, estimated: true })).toContain("≈73%");
    expect(render({ usedTokens: 6000, windowTokens: 8192, reservedTokens: 1024 })).toContain("is-near");
    expect(render({ usedTokens: 7600, windowTokens: 8192, reservedTokens: 1024 })).toContain("is-over");
  });

  it("renders an empty ring without a percentage before the first reply", () => {
    const html = render({ windowTokens: 8192, reservedTokens: 1024 });
    expect(html).toContain('aria-label="Context usage: —"');
    expect(html).not.toContain("chat-context-ring-used");
    expect(html).not.toContain("chat-context-ring-value");
  });
});
