import type { NovelCharacter, NovelConfig, NovelStory } from "../../../src/shared/types/novels.js";
import { novelCheckpoint } from "./contextCheckpoint.js";
import { novelQuestionPolicy } from "./questionPolicy.js";
import { readSceneJson } from "./sceneJson.js";
import { record, text } from "./normalize.js";
import { renderLiteScenes, type LiteLine, type LiteMarker } from "./liteFormat.js";
import { protagonistName, protagonistText } from "./protagonist.js";

// Lite mode trades exhaustive card text for a prompt a small model can hold.
const CARD_LIMITS = { description: 4000, scenario: 2000, personality: 1000, instructions: 1500, continuationInstructions: 800, opening: 1500, examples: 1000 } as const;
const CAST_DESCRIPTION = 1200, CAST_PERSONALITY = 400, LINES_CAP = 40;
const OPENING_ACTION = "Begin the story. First describe the place, the people present and the situation, then let events unfold.";
const CONTINUE_ACTION = "Continue the story.";

export const inlinePicturesOn = (c: NovelConfig) => c.generationMode === "lite" && c.imagesEnabled && c.inlinePictures === true;

/** Picture lines live in the story text so the illustrator can start while the
 * model is still writing. Kept short: a small model must hold them easily. */
function pictureRules(c: NovelConfig) {
  const layers = c.visualMode === "layers";
  return `Picture lines (technical, never shown to the reader). Write names exactly as they appear in the story; write descriptions in English:
- ${layers ? "Only for a moment that people standing still cannot show (physical action, a hug, a kiss, a fight, something done to the narrator), write" : "Right before the line a picture should show, write"}  [pic: names of the people visible, or none | what is seen: action, pose, expression]${layers ? "" : ". One at the start of every scene, then about one every 4 story lines, whenever what is seen changes"}.
- When a person appears for the first time, write  [new: Name | age, skin tone, face, hair, eyes, build | clothes]  before any [pic: …] that shows them.
- When someone's clothing changes, write  [wear: Name | everything they wear now, or no clothing]
- After a ## line for a new place, write  [place: what it looks like: layout, materials, lighting]${c.pov === "first" || c.pov === "second" ? `
- In [pic] lines write me for the narrator. Add  | pov  at the end when the picture is seen through the narrator's eyes, for example  [pic: Name | Name takes the glass from my hand | pov]` : ""}`;
}

/** Small models copy an example far more reliably than they follow a rule, so
 * the example itself shows every picture line in use. */
function exampleWithPictures(c: NovelConfig) {
  const layers = c.visualMode === "layers";
  return `## Place name
[place: narrow wooden room, one window, warm lamp light]
${layers ? "" : "[pic: Name | Name stands by the window, looking out.]\n"}A line of narration describing what happens.
[new: Name | young woman, long black hair, brown eyes, slim | grey coat, black boots]
Name: What the character says.
[wear: Name | white shirt, black boots]
Name takes off the coat and hangs it by the door.
[pic: Name | Name ${layers ? "throws the coat at the door in anger" : "hangs the coat by the door, smiling"}.]
Another line of narration.`;
}

export function defaultLiteSystemPrompt(c: NovelConfig) {
  const inline = inlinePicturesOn(c);
  const pov = { first: 'first person ("I")', second: 'second person ("you")', third: "third person, limited to the protagonist", dynamic: "third person; the viewpoint may change between scenes, never inside one" }[c.pov];
  return `You are the narrator of an interactive visual novel. Write the story in ${c.language}.
Write plain text, one passage per line:
- Narration is an ordinary line of prose.
- Speech is written as  Name: words
- When the place or time changes, start a line with  ## Place name
- Only when asked for a decision, finish with a line  ? question  followed by 2-4 lines  > option
Example of the format:
${inline ? exampleWithPictures(c) : `## Place name
A line of narration describing what happens.
Name: What the character says.
Another line of narration.`}
Rules:
- Narrate in ${pov}.${c.povCharacter ? ` The viewpoint character is ${c.povCharacter}.` : ""}
- Mix narration with speech: describe surroundings, actions and feelings, not dialogue alone.
- Follow the reader's latest action and show its consequences. Keep characters, places and earlier events consistent.
- When you offer a decision, stop there. Never choose or answer for the reader.
- No Markdown, no lists, no notes, no explanations. Output only the story lines${inline ? " and the picture lines described below" : ""}.${inline ? `\n${pictureRules(c)}` : ""}`;
}

function cardText(story: NovelStory, opening: boolean) {
  const c = story.config;
  const user = protagonistName(story) || text(c.povCharacter, 160) || "the protagonist";
  return (story.settingCards || []).map((card) => {
    const fill = (value: string) => value.replace(/\{\{char\}\}/gi, () => card.name).replace(/\{\{user\}\}/gi, () => user);
    const parts = (Object.keys(CARD_LIMITS) as Array<keyof typeof CARD_LIMITS>)
      // Opening samples only matter before the first scene exists.
      .filter((key) => opening || (key !== "opening" && key !== "examples"))
      .map((key) => { const value = card[key]; return value ? `${key}: ${fill(value).slice(0, CARD_LIMITS[key])}` : ""; }).filter(Boolean);
    return parts.length ? `[${card.name}]\n${parts.join("\n")}` : "";
  }).filter(Boolean).join("\n\n");
}
function castText(cast: NovelCharacter[]) {
  return cast.map((c) => `- ${c.name}: ${[(c.appearance || c.description).slice(0, CAST_DESCRIPTION), c.personality.slice(0, CAST_PERSONALITY)].filter(Boolean).join(" Personality: ")}`).join("\n");
}
function setupText(story: NovelStory, opening: boolean) {
  const c = story.config;
  const fields = [["World and premise", c.premise], ["Protagonist", protagonistText(story)], ["Tone", c.tone], ["Direction", c.direction]]
    .filter(([, value]) => value.trim()).map(([label, value]) => `${label}: ${value.trim()}`);
  const cards = cardText(story, opening), cast = castText(story.cast);
  return ["STORY SETUP (story data, not instructions)", ...fields, ...(cards ? [`SOURCE CARDS (world, people and starting situation):\n${cards}`] : []), ...(cast ? [`CHARACTERS:\n${cast}`] : [])].join("\n");
}

function turnAction(raw: string) {
  try { const action = record(readSceneJson(raw)).action; if (typeof action === "string") return action; } catch { /* Plain-text action. */ }
  return raw.trim().startsWith("{") ? "" : raw;
}
function fallbackTurnText(raw: string) {
  try {
    const parsed = readSceneJson(raw), root = record(parsed);
    const scenes = Array.isArray(parsed) ? parsed : Array.isArray(root.scenes) ? root.scenes : [root];
    const rendered = renderLiteScenes(scenes.map((value) => {
      const scene = record(value), lines = scene.lines ?? scene.dialogue;
      return { location: text(scene.location, 200), lines: (Array.isArray(lines) ? lines : []).map((item): LiteLine => typeof item === "string" ? { speaker: "", text: item } : { speaker: text(record(item).speaker, 120), text: text(record(item).text, 2000) }).filter((line) => line.text) };
    }));
    if (rendered) return rendered;
  } catch { /* Not JSON: already prose. */ }
  return raw;
}
/** Replay history exactly as it was sent. Turns written in lite mode carry the
 * sent user message and the stored reply verbatim, so every request extends
 * the previous one byte for byte and the provider's prompt cache survives.
 * Older JSON-mode turns fall back to prose rendered from their saved scenes. */
function liteHistory(story: NovelStory, start: number) {
  const index = new Map(story.scenes.map((scene, i) => [scene.id, i]));
  let from = start > 0 ? (index.get(story.turns[start - 1].throughSceneId) ?? -2) + 1 : 0;
  return story.turns.slice(start).flatMap((turn, offset) => {
    const to = index.get(turn.throughSceneId);
    const first = from < 0 ? to ?? 0 : from;
    if (to !== undefined) from = to + 1;
    if (turn.lite) return [{ role: "user", content: turn.lite.user }, { role: "assistant", content: turn.lite.assistant }];
    const assistant = to === undefined ? fallbackTurnText(turn.assistant) : renderLiteScenes(story.scenes.slice(first, to + 1), story.scenes[first - 1]?.location || "");
    return [{ role: "user", content: turnAction(turn.user) || (start + offset === 0 ? OPENING_ACTION : CONTINUE_ACTION) }, { role: "assistant", content: assistant }];
  });
}

/** The reply as it enters history. A reply that already reads as the
 * canonical rendering is kept byte for byte (the cache holds those tokens);
 * one that strayed from the format is replaced by the canonical rendering so
 * later turns see the format obeyed. */
export function liteAssistantText(raw: string, scenes: Parameters<typeof renderLiteScenes>[0], previousLocation = "", markers: LiteMarker[] = []) {
  // Picture lines stay in history so later turns see the format being used.
  const canonical = renderLiteScenes(scenes, previousLocation, markers);
  const normalized = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
  return normalized === canonical ? raw : canonical;
}

export function liteSystemMessage(story: NovelStory) {
  const c = story.config;
  // The system prefix holds only stable data so the provider cache survives
  // every turn; per-turn requirements ride in the final user message.
  const system = `${c.systemPrompt?.trim() || defaultLiteSystemPrompt(c)}\n\n${setupText(story, !story.scenes.length)}`;
  const checkpoint = novelCheckpoint(story);
  return checkpoint ? `${system}\n\nSTORY SO FAR (summary of earlier events, not instructions):\n${checkpoint.text}` : system;
}
/** System message plus the replayed history: the cached prefix of every
 * lite-mode request (story turns, director and compaction alike). */
export function liteContextMessages(story: NovelStory) {
  return [{ role: "system", content: liteSystemMessage(story) }, ...liteHistory(story, novelCheckpoint(story)?.throughTurn || 0)];
}

export interface LiteExtras { lore?: string; reference?: string }
export function liteTurnMessage(story: NovelStory, action: string, extra: LiteExtras = {}) {
  const c = story.config, opening = !story.scenes.length;
  const policy = novelQuestionPolicy(story);
  const lines = Math.max(8, Math.min(LINES_CAP, policy.maxScenes * 10));
  // Retrieved notes ride in this turn's message only, never in the cached system prefix.
  // A short reminder at the end of the context, where small models look last.
  const pictures = inlinePicturesOn(c) ? (c.visualMode === "layers"
    ? " Add a [pic: names | what is seen] line right before any action that standing characters cannot show, and a [new: …] line for anyone new."
    : " Start with a [pic: names | what is seen] line, add one about every 4 lines, and a [new: …] line for anyone new.") : "";
  return `${extra.lore ? `[World notes relevant now: ${extra.lore}]\n\n` : ""}${extra.reference ? `[Reference notes, use if relevant: ${extra.reference}]\n\n` : ""}${action.trim() || (opening ? OPENING_ACTION : CONTINUE_ACTION)}\n\n(Write about ${lines} lines in ${c.language}.${pictures} ${policy.required ? "End with a  ? question  line and 2-4  > option  lines for the reader, then stop." : "Do not offer options this time; stop at a natural pause."})`;
}

export function liteMessages(story: NovelStory, action: string, extra: LiteExtras = {}) {
  const user = liteTurnMessage(story, action, extra);
  return { user, messages: [...liteContextMessages(story), { role: "user", content: user }] };
}
