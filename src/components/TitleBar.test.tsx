import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TitleBar } from "./TitleBar";

afterEach(() => vi.unstubAllGlobals());

describe("Electron immersive title bar", () => {
  it("does not leave a native drag region over the hover navigation", () => {
    vi.stubGlobal("window", { electronAPI: {} });
    expect(renderToStaticMarkup(<TitleBar immersive />)).toContain("-webkit-app-region:no-drag");
    expect(renderToStaticMarkup(<TitleBar />)).toContain("-webkit-app-region:drag");
  });
});
