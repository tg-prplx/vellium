import { describe, expect, it } from "vitest";
import { describeBlockedMcpLaunch } from "./mcp.js";

describe("describeBlockedMcpLaunch", () => {
  it("blocks Node inline-eval flags with attached values", () => {
    expect(describeBlockedMcpLaunch("node", ["--eval=console.log('safe-marker')"]))
      .toContain("Inline eval for node");
    expect(describeBlockedMcpLaunch("node", ["-e=console.log('safe-marker')"]))
      .toContain("Inline eval for node");
  });

  it("continues to block separated Node inline-eval flags", () => {
    expect(describeBlockedMcpLaunch("node", ["--eval", "console.log('safe-marker')"]))
      .toContain("Inline eval for node");
    expect(describeBlockedMcpLaunch("node", "-e \"console.log('safe-marker')\""))
      .toContain("Inline eval for node");
  });

  it("blocks Deno's eval subcommand and permits regular script launches", () => {
    expect(describeBlockedMcpLaunch("deno", ["eval", "console.log('safe-marker')"]))
      .toContain("Inline eval for deno");
    expect(describeBlockedMcpLaunch("node", ["server.js"])).toBe("");
  });
});
