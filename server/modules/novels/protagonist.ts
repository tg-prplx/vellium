import type { NovelCharacter, NovelIllustration, NovelPersona, NovelStory } from "../../../src/shared/types/novels.js";
import { db } from "../../db.js";
import { text } from "./normalize.js";

/** The protagonist is the chosen user persona when there is one, otherwise the
 * free-text field. Every prompt and parser asks here, so both modes agree. */
export function protagonistName(story: Pick<NovelStory, "config" | "persona">) {
  return story.persona?.name || text(story.config.protagonist, 160);
}
export function protagonistText(story: Pick<NovelStory, "config" | "persona">) {
  const p = story.persona;
  if (!p) return story.config.protagonist;
  return [p.name, p.description.slice(0, 800), p.personality ? `Personality: ${p.personality.slice(0, 300)}` : ""].filter((part) => part.trim()).join(". ");
}

/** Snapshot the persona so later edits or deletion in the library never
 * change a running story's prompt (and its cache) behind the reader's back. */
export function snapshotPersona(id: string | undefined, previous?: NovelPersona): NovelPersona | undefined {
  if (!id) return undefined;
  if (previous?.id === id) return previous;
  const row = db.prepare("SELECT id, name, description, personality FROM user_personas WHERE id = ?").get(id) as NovelPersona | undefined;
  if (!row) throw Object.assign(new Error("Selected persona no longer exists"), { status: 400 });
  return { id: row.id, name: text(row.name, 120), description: text(row.description, 4000), personality: text(row.personality, 2000) };
}

export const PROTAGONIST_ID = "protagonist";
const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
/** How picture lines name the narrator ("me", "я", …). */
export const isViewerWord = (name: string) => /^(?:me|i|myself|you|yourself|я|меня|мне|мной|ты|тебя|narrator|protagonist|viewer)$/i.test(name.trim());
export const narratesInPerson = (story: Pick<NovelStory, "config">) => story.config.pov === "first" || story.config.pov === "second";

/** The protagonist as a drawable person: their story character if one exists,
 * otherwise one built from the persona or the protagonist field, so pictures
 * can show them (or keep them behind a first-person view) consistently. */
export function protagonistCharacter(story: Pick<NovelStory, "config" | "persona" | "memory">): NovelCharacter | undefined {
  const name = protagonistName(story);
  if (!name) return undefined;
  const existing = story.memory.characters.find((c) => same(c.name, name));
  if (existing) return existing;
  const looks = story.persona ? story.persona.description : story.config.protagonist.trim() !== name ? story.config.protagonist : "";
  return { id: PROTAGONIST_ID, name, description: "", appearance: text(looks, 2000), personality: "", relationships: "", state: "" };
}

/** Camera for a picture the narrator marked without one, in dynamic mode: an
 * explicit "pov" / "over-shoulder" / "wide" wins; otherwise a first- or
 * second-person story looks through the narrator's eyes whenever the picture
 * involves them ("my hand", "me" among the names). */
export function inferCamera(story: Pick<NovelStory, "config">, shot: { who: string[]; see: string; hint?: string }): NovelIllustration["camera"] | undefined {
  const hint = (shot.hint || "").toLowerCase();
  if (/\b(?:pov|first[- ]person|my eyes|through)\b/.test(hint)) return "first-person";
  if (/shoulder/.test(hint)) return "over-shoulder";
  if (/\b(?:wide|external|side|third)\b/.test(hint)) return "external";
  if (!narratesInPerson(story)) return undefined;
  const pronoun = story.config.pov === "second" ? /\b(?:you|your|yours|yourself)\b/i : /\b(?:I|me|my|mine|myself)\b/;
  return shot.who.some(isViewerWord) || pronoun.test(shot.see) ? "first-person" : undefined;
}
