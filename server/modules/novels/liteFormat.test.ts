import { describe, expect, it } from "vitest";
import { parseLiteText, renderLiteScenes } from "./liteFormat.js";

// All story text here is synthetic.
describe("lite story format", () => {
  it("reads headers, speech, narration and a closing decision", () => {
    const batch = parseLiteText(`## Test harbour\nFog drifts over the invented pier.\nMira: Did you bring the key?\n*She waits by the rail.*\n## Test archive\nShelves fill the synthetic hall.\n? What do you do?\n> Open the ledger\n> Leave quietly`);
    expect(batch.scenes).toEqual([
      { location: "Test harbour", lines: [{ speaker: "", text: "Fog drifts over the invented pier." }, { speaker: "Mira", text: "Did you bring the key?" }, { speaker: "", text: "She waits by the rail." }] },
      { location: "Test archive", lines: [{ speaker: "", text: "Shelves fill the synthetic hall." }] }]);
    expect(batch.question).toBe("What do you do?"); expect(batch.choices).toEqual(["Open the ledger", "Leave quietly"]);
  });
  it("turns a reply that ignores the format into narration instead of failing", () => {
    const batch = parseLiteText("<think>plan</think>Sure, here it goes.\n\nHe said: we should leave before the tide. The time was 10:30 and nobody answered.\n\n{\"broken\": [json");
    expect(batch.scenes).toHaveLength(1); expect(batch.scenes[0].lines.every((line) => line.speaker === "")).toBe(true);
    expect(batch.scenes[0].lines).toHaveLength(3);
  });
  it("recognises known and non-Latin speakers, Markdown names, quotes and list-style options", () => {
    const batch = parseLiteText(`**Мира:** «Ты принёс ключ?»\nстарый смотритель: Тихо.\nАнна (шёпотом): Идём.\n美羽：行きましょう。\n? Куда пойти?\n1. В архив\n2) На пирс\n- Остаться`, ["Старый смотритель"]);
    expect(batch.scenes[0].lines).toEqual([{ speaker: "Мира", text: "Ты принёс ключ?" }, { speaker: "старый смотритель", text: "Тихо." }, { speaker: "Анна", text: "Идём." }, { speaker: "美羽", text: "行きましょう。" }]);
    expect(batch.choices).toEqual(["В архив", "На пирс", "Остаться"]);
  });
  it("drops prose written after the decision and a lone option", () => {
    const batch = parseLiteText("A synthetic line.\n> Only option\nThe narrator answers for the reader anyway.");
    expect(batch.choices).toEqual([]); expect(batch.scenes[0].lines).toHaveLength(1);
  });
  it("splits oversized scenes and rejects an empty reply", () => {
    const batch = parseLiteText(Array.from({ length: 45 }, (_, i) => `Synthetic passage number ${i}.`).join("\n"));
    expect(batch.scenes.map((scene) => scene.lines.length)).toEqual([40, 5]);
    expect(() => parseLiteText("<think>only thoughts</think>\n---\n")).toThrow("no story text");
  });
  it("renders saved scenes canonically and round-trips", () => {
    const text = "## Test harbour\nFog drifts over the invented pier.\nMira: Did you bring the key?\n? What now?\n> Open it\n> Wait";
    const batch = parseLiteText(text);
    expect(renderLiteScenes(batch.scenes.map((scene) => ({ ...scene, question: batch.question, choices: batch.choices })))).toBe(text);
    expect(renderLiteScenes([{ location: "Test harbour", lines: [{ speaker: "", text: "Still here." }] }], "Test harbour")).toBe("Still here.");
  });
});
