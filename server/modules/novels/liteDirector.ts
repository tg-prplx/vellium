import { createHash, randomUUID } from "crypto";
import type { NovelCharacter, NovelConfig, NovelIllustration, NovelScene, NovelStory } from "../../../src/shared/types/novels.js";
import { scheduleNovelFrames } from "../../../src/shared/novelFrameSchedule.js";
import type { UnifiedProviderRow, UnifiedResponseFormat } from "../../services/unifiedGeneration.js";
import { ensureSceneIllustration } from "./illustrationPlan.js";
import { mergeMemory, record, strings, text } from "./normalize.js";
import { novelSchemaEnabled } from "./responseSchema.js";
import { readSceneJson } from "./sceneJson.js";
import { applyVisualContinuity } from "./visualContinuity.js";
import { layersEnabled, registerLayerAssets } from "./layers.js";
import { legacyOutfit, normalizeOutfit } from "./wardrobe.js";
import { inferCamera, isViewerWord, narratesInPerson, protagonistCharacter } from "./protagonist.js";

/** The director is a short technical follow-up appended to the same
 * conversation that produced the story text. It never carries its own system
 * prompt, so the provider reuses the cached prefix and the model keeps every
 * instruction the story itself was written under. */
export interface DirectorNeeds {
  choices: boolean; visuals: boolean;
  /** Known people in pictures who still lack a picture look or clothes. */
  describe?: string[];
}
export interface LinePos { scene: number; line: number }
export interface DirectorPlan {
  question: string; choices: string[];
  people: Array<{ name: string; look: string; clothes: string }>;
  places: Array<{ name: string; look: string }>;
  /** `pos` is an exact line (inline picture lines); otherwise `at` is a quote. */
  shots: Array<{ at: string; who: string[]; camera?: NovelIllustration["camera"]; see: string; pos?: LinePos; id?: string; hint?: string }>;
  outfits: Array<{ name: string; clothes: string; at: string; pos?: LinePos }>;
}
const CAMERAS = ["external", "first-person", "over-shoulder"] as const;
const EMPTY: DirectorPlan = { question: "", choices: [], people: [], places: [], shots: [], outfits: [] };

export function directorNeeds(config: NovelConfig, choicesRequired: boolean, scenes: NovelScene[]): DirectorNeeds {
  const last = scenes.at(-1);
  return { choices: choicesRequired && Boolean(last) && (last!.choices.length < 2), visuals: config.imagesEnabled };
}

/** First/second-person stories: how to name the narrator and mark their view. */
const narratorRule = (story: NovelStory, lines: boolean) => narratesInPerson(story)
  ? `\nThe narrator is "me": write me among the names when the narrator is visible.${lines ? " Add  | pov  after what the picture shows when it is seen through the narrator's eyes." : ""}`
  : "";
const cameraRule = (story: NovelStory) => (story.config.imagePov || "dynamic") === "dynamic" ? " camera = external, first-person or over-shoulder." : "";
/** What the people in the new scenes wear right now, so a change can be given
 * as the complete new outfit instead of a fragment ("without the jacket"). */
function currentClothes(story: NovelStory, sceneCount: number) {
  const scenes = story.scenes.slice(-sceneCount), words = ` ${scenes.flatMap((s) => s.lines.map((l) => `${l.speaker} ${l.text}`)).join(" ").toLocaleLowerCase()} `;
  const outfits = scenes[0]?.visuals?.outfits || {};
  return story.memory.characters.filter((c) => !c.isGroup && c.name && words.includes(c.name.toLocaleLowerCase().split(/\s+/)[0]))
    .map((c) => [c.name, outfits[c.id] || c.outfit || legacyOutfit(c.appearance || c.description)]).filter(([, outfit]) => outfit).slice(0, 8)
    .map(([name, outfit]) => `${name}: ${outfit}`).join("; ");
}
const knownPeople = (story: NovelStory) => story.memory.characters.filter((c) => !c.isGroup).map((c) => c.name);

export function directorInstruction(story: NovelStory, needs: DirectorNeeds, sceneCount: number) {
  const known = knownPeople(story);
  const rules = [
    ...(needs.visuals ? [
      `- people: people from that part who are NOT in the known list${needs.describe?.length ? `, and also these known people, who still need a picture description: ${needs.describe.join(", ")}` : ""}. look = age, skin tone, face, hair, eyes, body build. clothes = what they wear now.`,
      "- places: each new place. name = exactly as in its ## line. look = layout, materials, lighting.",
      layersEnabled(story.config)
        ? `- events: a full picture for each moment that people standing still cannot show: physical action, contact between people (a hug, a kiss, a fight), something done to the narrator, a reveal. At most one per scene; [] for scenes that are only talking. at = copy the first 5 words of the line where it happens. who = names of the people visible.${cameraRule(story)} see = what the picture shows at that line, exactly as the text says: action, pose, expression. Do not describe hair or faces; mention clothing only when it changes in that moment.`
        : `- shots: one picture for the start of each of the ${sceneCount} scenes, plus pictures for important moments, at most ${story.config.imagesPerScene} per scene. at = copy the first 5 words of the line where the picture starts. who = names of the people visible, [] if none.${cameraRule(story)} see = what the picture shows at that line, exactly as the text says: action, pose, expression. Do not describe hair or faces; mention clothing only when it changes in that moment.`,
      "- outfits: for each person whose clothing changed in that part (took something off, put something on, changed clothes): their COMPLETE clothing right after the change, written like the current clothes list; \"no clothing\" if they wear nothing. at = first 5 words of the line where it happens. [] if nobody's clothing changed."
    ] : []),
    ...(needs.choices ? ["- question, choices: one question to the reader and 2-4 short options for what to do next."] : [])
  ];
  return `[Technical task. Do not continue the story.]
Describe the part you just wrote for the illustrator. Reply with JSON only.
Known people: ${known.length ? known.join(", ") : "none"}.${needs.visuals && currentClothes(story, sceneCount) ? `\nCurrent clothes: ${currentClothes(story, sceneCount)}.` : ""}${needs.visuals ? narratorRule(story, false) : ""}
${rules.join("\n")}
${needs.visuals ? "Write look, clothes and see in English." : ""}`.trim();
}

/** Plain line format for providers without structured output. */
export function directorLineInstruction(story: NovelStory, needs: DirectorNeeds, sceneCount: number) {
  const known = knownPeople(story);
  const rules = [
    ...(needs.visuals ? [
      `PERSON | Name | age, skin tone, face, hair, eyes, build | clothes   (people not in the known list${needs.describe?.length ? `, and also: ${needs.describe.join(", ")}` : ""})`,
      "PLACE | place name exactly as in its ## line | layout, materials, lighting",
      layersEnabled(story.config)
        ? "EVENT | first 5 words of the line | names of visible people, or none | what the picture shows   (for a moment people standing still cannot show: physical action, a hug, a kiss, a fight, something done to the narrator, a reveal; at most one per scene, none for talking)"
        : `SHOT | first 5 words of the line where the picture starts | names of visible people, or none | what the picture shows   (one for the start of each of the ${sceneCount} scenes, at most ${story.config.imagesPerScene} per scene)`,
      "OUTFIT | Name | complete clothing right after the change, or no clothing | first 5 words of the line   (only for people whose clothing changed)"
    ] : []),
    ...(needs.choices ? ["ASK | one question to the reader", "OPTION | a short option   (2-4 lines)"] : [])
  ];
  return `[Technical task. Do not continue the story.]
Describe the part you just wrote for the illustrator. One item per line, nothing else:
${rules.join("\n")}
Known people: ${known.length ? known.join(", ") : "none"}.${needs.visuals && currentClothes(story, sceneCount) ? ` Current clothes: ${currentClothes(story, sceneCount)}.` : ""}${needs.visuals ? narratorRule(story, true) : ""}${needs.visuals ? " Write descriptions in English. In SHOT lines describe what happens at that line; mention clothing only when it changes there." : ""}`;
}

export function directorResponseFormat(story: NovelStory, provider: UnifiedProviderRow, needs: DirectorNeeds, sceneCount: number): UnifiedResponseFormat | undefined {
  if (!novelSchemaEnabled(story.config, provider)) return;
  const string = { type: "string" }, strs = { type: "array", items: string };
  const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
  const dynamic = (story.config.imagePov || "dynamic") === "dynamic";
  const properties: Record<string, unknown> = {
    ...(needs.choices ? { question: { type: "string", minLength: 1 }, choices: { ...strs, minItems: 2, maxItems: 4 } } : {}),
    ...(needs.visuals ? {
      people: { type: "array", maxItems: 6, items: object({ name: string, look: string, clothes: string }) },
      places: { type: "array", maxItems: Math.max(1, sceneCount), items: object({ name: string, look: string }) },
      [layersEnabled(story.config) ? "events" : "shots"]: { type: "array", ...(layersEnabled(story.config) ? { minItems: 0, maxItems: sceneCount } : { minItems: sceneCount, maxItems: sceneCount * story.config.imagesPerScene }),
        items: object({ at: string, who: strs, ...(dynamic ? { camera: { type: "string", enum: CAMERAS } } : {}), see: { type: "string", minLength: 1 } }) },
      outfits: { type: "array", maxItems: 4, items: object({ name: string, clothes: string, at: string }) }
    } : {})
  };
  return { type: "json_schema", json_schema: { name: "novel_director", strict: true, schema: object(properties) } };
}

export const nameList = (value: string) => /^(?:none|no one|nobody|-|—|\[\])?$/i.test(value.trim()) ? [] : value.split(/\s*(?:,|;|&|\band\b)\s*/i).map((name) => name.trim()).filter(Boolean).slice(0, 12);

export function parseDirectorReply(raw: string): DirectorPlan {
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (/^(?:```(?:json)?\s*)?[[{]/i.test(clean)) {
    let parsed: unknown;
    try { parsed = readSceneJson(clean); } catch { return EMPTY; }
    const root = record(parsed), list = (key: string) => (Array.isArray(root[key]) ? root[key] as unknown[] : []).map(record);
    return {
      question: text(root.question, 1000), choices: strings(root.choices, 4).map((c) => c.slice(0, 300)),
      people: list("people").map((p) => ({ name: text(p.name, 120), look: text(p.look, 600), clothes: text(p.clothes, 400) })).filter((p) => p.name && p.look).slice(0, 6),
      places: list("places").map((p) => ({ name: text(p.name, 200), look: text(p.look, 400) })).filter((p) => p.name && p.look),
      shots: [...list("shots"), ...list("events")].map((p) => ({ at: text(p.at, 200), who: Array.isArray(p.who) ? strings(p.who, 12) : nameList(text(p.who, 300)),
        ...(CAMERAS.includes(p.camera as typeof CAMERAS[number]) ? { camera: p.camera as NovelIllustration["camera"] } : {}), see: text(p.see, 600) })).filter((p) => p.see),
      outfits: list("outfits").map((p) => ({ name: text(p.name, 120), clothes: normalizeOutfit(text(p.clothes, 400)), at: text(p.at, 200) })).filter((p) => p.name && p.clothes).slice(0, 4)
    };
  }
  const plan: DirectorPlan = { question: "", choices: [], people: [], places: [], shots: [], outfits: [] };
  for (const source of clean.split(/\r?\n/)) {
    const cells = source.replace(/^[\s\-*•\d.)]*(?=[A-Za-z])/, "").split("|").map((cell) => cell.trim().replace(/^\*+|\*+$/g, ""));
    const kind = cells[0]?.toUpperCase();
    if (kind === "PERSON" && cells[1] && cells[2]) plan.people.push({ name: text(cells[1], 120), look: text(cells[2], 600), clothes: text(cells[3], 400) });
    else if (kind === "PLACE" && cells[1] && cells[2]) plan.places.push({ name: text(cells[1], 200), look: text(cells.slice(2).join(", "), 400) });
    else if ((kind === "SHOT" || kind === "EVENT") && cells.length >= 4 && cells.slice(3).join(" ").trim()) {
      // A trailing "pov" / "wide" / "over-shoulder" cell is a camera hint, not part of the picture.
      const hinted = cells.length > 4 && /^(?:pov|first[- ]person|wide|external|side|over[- ]?(?:the[- ])?shoulder)$/i.test(cells[cells.length - 1]);
      plan.shots.push({ at: text(cells[1], 200), who: nameList(cells[2]), see: text((hinted ? cells.slice(3, -1) : cells.slice(3)).join(", "), 600), ...(hinted ? { hint: cells[cells.length - 1] } : {}) });
    }
    else if (kind === "OUTFIT" && cells[1] && cells[2]) plan.outfits.push({ name: text(cells[1], 120), clothes: normalizeOutfit(text(cells[2], 400)), at: text(cells[3], 200) });
    else if (kind === "ASK" && cells[1]) plan.question = text(cells.slice(1).join(" "), 1000);
    else if (kind === "OPTION" && cells[1] && plan.choices.length < 4) plan.choices.push(text(cells.slice(1).join(" "), 300));
  }
  plan.people = plan.people.slice(0, 6); plan.outfits = plan.outfits.slice(0, 4);
  return plan;
}

const fold = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Locate the line a quote starts. Small models copy reliably but count
 * poorly, so a pasted prefix is matched instead of an index. */
export function findQuotedLine(scenes: Pick<NovelScene, "lines">[], quote: string): { scene: number; line: number } | null {
  const needle = fold(quote);
  if (!needle) return null;
  const lines = scenes.flatMap((scene, s) => scene.lines.map((line, l) => ({ scene: s, line: l, text: fold(line.text), full: fold(`${line.speaker} ${line.text}`) })));
  const hit = lines.find((item) => item.text.startsWith(needle) || item.full.startsWith(needle))
    || lines.find((item) => item.text.includes(needle))
    || (needle.split(" ").length >= 3 ? lines.find((item) => item.text.startsWith(needle.split(" ").slice(0, 3).join(" "))) : undefined);
  return hit ? { scene: hit.scene, line: hit.line } : null;
}

const personId = (name: string) => `c-${createHash("sha256").update(name.toLocaleLowerCase()).digest("hex").slice(0, 16)}`;
const validPos = (scenes: Pick<NovelScene, "lines">[], pos?: LinePos) => pos && scenes[pos.scene]?.lines[pos.line] ? pos : null;
/** The given line if it is full prose, else the nearest full line after it, then before it. */
function fullLineNear(scene: Pick<NovelScene, "lines">, line: number) {
  const full = (i: number) => (scene.lines[i]?.text.trim().length || 0) >= 12;
  for (let i = line; i < scene.lines.length; i++) if (full(i)) return i;
  for (let i = line - 1; i >= 0; i--) if (full(i)) return i;
  return -1;
}
const firstFullLine = (scene: Pick<NovelScene, "lines">) => scene.lines.findIndex((line) => line.text.trim().length >= 12);

/** Apply a plan to the newest scenes of `story`. Missing or unusable parts
 * degrade to an establishing shot and no choice; the saved text is never lost. */
export function applyDirectorPlan(story: NovelStory, count: number, plan: DirectorPlan, needs: DirectorNeeds): NovelStory {
  const scenes = story.scenes.slice(-count).map((scene) => ({ ...scene, illustrations: [...scene.illustrations] }));
  const base = { ...story, scenes: story.scenes.slice(0, -count) };
  let memory = story.memory;
  const layers = layersEnabled(story.config);
  if (needs.visuals) {
    // New people are added; known ones only gain a picture look and clothes
    // they lacked (existing anchors are never rewritten).
    const byName = (name: string) => memory.characters.find((c) => c.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    const patches = plan.people.map((p): Partial<NovelCharacter> => {
      const known = byName(p.name);
      return known ? { id: known.id, look: p.look, ...(p.clothes ? { outfit: p.clothes } : {}) }
        : { id: personId(p.name), name: p.name, appearance: p.look, look: p.look, ...(p.clothes ? { outfit: p.clothes } : {}) };
    });
    if (patches.length) memory = mergeMemory(memory, { characters: patches });
    // "me" and the protagonist's name both mean the protagonist.
    const hero = protagonistCharacter({ ...story, memory });
    const idOf = (name: string) => isViewerWord(name) || (hero && hero.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()) ? hero?.id
      : memory.characters.find((c) => c.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())?.id;
    const dynamic = (story.config.imagePov || "dynamic") === "dynamic";
    const frames: NovelIllustration[][] = scenes.map(() => []);
    // Layers mode: full frames only for action sprites cannot show, one per scene at most.
    const shots = plan.shots;
    // Frames the narrator placed come first; a director frame within a line of
    // one of them would show the same moment twice and is skipped.
    const placed = shots.filter((shot) => validPos(scenes, shot.pos)).map((shot) => shot.pos!);
    shots.forEach((shot, i) => {
      const exact = validPos(scenes, shot.pos);
      const at = exact || findQuotedLine(scenes, shot.at) || { scene: Math.min(i, scenes.length - 1), line: 0 };
      if (!exact && placed.some((p) => p.scene === at.scene && Math.abs(p.line - at.line) <= 1)) return;
      const camera = shot.camera || (dynamic ? inferCamera(story, shot) : undefined);
      const ids = shot.who.map(idOf).filter((id): id is string => Boolean(id));
      // Seen from outside, a picture about "me" must show the protagonist.
      const firstPersonPicture = camera === "first-person" || (!dynamic && story.config.imagePov === "first");
      if (hero && !firstPersonPicture && inferCamera({ config: { ...story.config, imagePov: "dynamic" } }, { who: shot.who, see: shot.see }) === "first-person") ids.push(hero.id);
      frames[at.scene].push({ id: shot.id || randomUUID(), prompt: shot.see, atLine: at.line, seed: 0, url: null, status: "pending",
        characterIds: [...new Set(ids)], ...(camera ? { camera } : {}) });
    });
    const outfits = scenes.map(() => ({} as Record<string, string>)), changes = scenes.map(() => ({} as Record<string, number>));
    for (const outfit of plan.outfits) {
      // A wrong quote must not lose the change: fall back to the first full line
      // of the last new scene, so the new outfit holds from then on.
      const id = idOf(outfit.name), last = scenes.length - 1;
      const at = validPos(scenes, outfit.pos) || findQuotedLine(scenes, outfit.at) || (firstFullLine(scenes[last]) >= 0 ? { scene: last, line: firstFullLine(scenes[last]) } : null);
      // A change must cite a full line of prose; short replies do not count.
      const line = at ? fullLineNear(scenes[at.scene], at.line) : -1;
      if (id && at && line >= 0) { outfits[at.scene][id] = outfit.clothes; changes[at.scene][id] = line; }
    }
    scenes.forEach((scene, i) => {
      scene.memory = memory;
      // Layers mode: the background opens the scene; an action frame starts at its own line.
      scene.illustrations = layers ? frames[i].slice(0, 1) : scheduleNovelFrames(frames[i], scene.lines.length, story.config.imagesPerScene);
      if (!layers) ensureSceneIllustration(scene);
    });
    applyVisualContinuity(base, scenes, scenes.map((scene, i) => ({
      location: scene.location, locationChange: firstFullLine(scene),
      setting: plan.places.find((p) => fold(p.name) === fold(scene.location))?.look || "",
      outfits: outfits[i], outfitChanges: changes[i] })));
    // Outfits are stored per scene; frames before a mid-scene change keep the
    // clothes worn at their own line.
    scenes.forEach((scene, i) => {
      const before = i ? scenes[i - 1].visuals?.outfits : base.scenes.at(-1)?.visuals?.outfits;
      for (const [id, line] of Object.entries(changes[i])) {
        const old = before?.[id] || memory.characters.find((c) => c.id === id)?.outfit;
        if (!old || old === outfits[i][id] || scene.visuals?.outfits[id] !== outfits[i][id]) continue;
        for (const frame of scene.illustrations) if (frame.atLine < line) frame.outfits = { ...frame.outfits, [id]: old };
      }
    });
  }
  if (needs.choices && plan.choices.length >= 2) {
    const last = scenes[scenes.length - 1];
    last.question = plan.question; last.choices = plan.choices;
  }
  const next = { ...story, memory, scenes: [...base.scenes, ...scenes] };
  return layers && needs.visuals ? registerLayerAssets(next, count) : next;
}

/** Text is saved; a failed director still leaves every scene drawable. */
export function directorFallback(story: NovelStory, count: number, needs: DirectorNeeds): NovelStory {
  if (!needs.visuals) return story;
  const layers = layersEnabled(story.config);
  const scenes = story.scenes.slice(-count).map((scene) => ({ ...scene, illustrations: [...scene.illustrations] }));
  if (!layers) for (const scene of scenes) ensureSceneIllustration(scene);
  applyVisualContinuity({ ...story, scenes: story.scenes.slice(0, -count) }, scenes, scenes.map((scene) => ({ location: scene.location, locationChange: firstFullLine(scene) })));
  const next = { ...story, scenes: [...story.scenes.slice(0, -count), ...scenes] };
  return layers ? registerLayerAssets(next, count) : next;
}
