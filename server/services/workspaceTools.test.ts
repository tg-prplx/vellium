import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareWorkspaceTools } from "./workspaceTools.js";

describe("prepareWorkspaceTools", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks reads through symlinks that resolve outside the workspace", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "slv-workspace-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "slv-outside-"));
    cleanup.push(workspaceDir, outsideDir);
    writeFileSync(join(outsideDir, "secret.txt"), "do not leak", "utf8");
    symlinkSync(outsideDir, join(workspaceDir, "outside-link"), "dir");

    const tools = prepareWorkspaceTools(workspaceDir);
    const result = await tools.executeToolCall(
      "workspace_read_file",
      JSON.stringify({ path: "outside-link/secret.txt" })
    );

    expect(result.modelText).toContain("Path escapes the workspace root");
  });

  it("blocks writes through symlinked parent directories outside the workspace", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "slv-workspace-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "slv-outside-"));
    cleanup.push(workspaceDir, outsideDir);
    symlinkSync(outsideDir, join(workspaceDir, "outside-link"), "dir");

    const tools = prepareWorkspaceTools(workspaceDir);
    const result = await tools.executeToolCall(
      "workspace_write_file",
      JSON.stringify({ path: "outside-link/new.txt", content: "nope" })
    );

    expect(result.modelText).toContain("Path escapes the workspace root");
    expect(existsSync(join(outsideDir, "new.txt"))).toBe(false);
  });
});
