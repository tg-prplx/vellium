import { describe, expect, it } from "vitest";
import { getTriggeredLoreEntries, injectLoreBlocks, normalizeLoreBookEntries } from "../../server/domain/lorebooks";
import type { PromptBlock } from "../../server/domain/rpEngine";

describe("lorebooks trigger matching", () => {
  it("does not trigger short word keys as substrings", () => {
    const entries = normalizeLoreBookEntries([
      { id: "he", keys: ["he"], content: "he-lore", enabled: true, constant: false, position: "after_char", insertion_order: 100 },
      { id: "hero", keys: ["hero"], content: "hero-lore", enabled: true, constant: false, position: "after_char", insertion_order: 200 }
    ]);

    const fromShe = getTriggeredLoreEntries(entries, ["she moved through the hall"]);
    expect(fromShe.map((item) => item.id)).toEqual([]);

    const fromHero = getTriggeredLoreEntries(entries, ["the hero arrived"]);
    expect(fromHero.map((item) => item.id)).toEqual(["hero"]);
  });
});

describe("lorebooks position anchors", () => {
  it("places author_note/history anchors near their proper prompt stack orders", () => {
    const baseBlocks: PromptBlock[] = [
      { id: "1", kind: "system", enabled: true, order: 1, content: "" },
      { id: "2", kind: "jailbreak", enabled: true, order: 2, content: "" },
      { id: "3", kind: "character", enabled: true, order: 3, content: "" },
      { id: "4", kind: "author_note", enabled: true, order: 4, content: "" },
      { id: "6", kind: "scene", enabled: true, order: 6, content: "" },
      { id: "7", kind: "history", enabled: true, order: 7, content: "" }
    ];

    const entries = normalizeLoreBookEntries([
      { id: "before-note", keys: [], content: "A", enabled: true, constant: true, position: "before_author_note", insertion_order: 100 },
      { id: "after-history", keys: [], content: "B", enabled: true, constant: true, position: "after_history", insertion_order: 200 }
    ]);
    const injected = injectLoreBlocks(baseBlocks, entries);

    const byContent = new Map(injected.map((block) => [block.content, block]));
    const beforeNote = byContent.get("A");
    const afterHistory = byContent.get("B");

    expect(beforeNote).toBeTruthy();
    expect(afterHistory).toBeTruthy();
    expect((beforeNote?.order ?? 999)).toBeLessThan(4);
    expect((afterHistory?.order ?? 0)).toBeGreaterThan(7);
  });
});
