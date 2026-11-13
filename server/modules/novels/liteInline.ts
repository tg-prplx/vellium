import { randomUUID } from "crypto";
import type { NovelStory } from "../../../src/shared/types/novels.js";
import type { LiteBatch, LiteMarker } from "./liteFormat.js";
import { nameList, type DirectorPlan } from "./liteDirector.js";
import { normalizeOutfit } from "./wardrobe.js";
import { hasPictureLook, knownOutfit } from "./looks.js";
import { inferCamera, isViewerWord, protagonistCharacter } from "./protagonist.js";
import { text } from "./normalize.js";

/** Turn the picture lines the narrator wrote into the same plan the director
 * follow-up produces, with exact line positions instead of quotes. `picIds`
 * keeps frame IDs stable between the streaming preview and the saved story. */
export function inlinePlan(story: NovelStory, batch: LiteBatch, count: number, picIds: string[] = []): DirectorPlan {
  const scenes = story.scenes.slice(-count);
  const plan: DirectorPlan = { question: "", choices: [], people: [], places: [], shots: [], outfits: [] };
  let pic = 0;
  for (const marker of batch.markers) {
    const scene = scenes[marker.scene];
    if (!scene) continue;
    const pos = { scene: marker.scene, line: marker.line }, cells = marker.cells;
    if (marker.kind === "pic") {
      const see = text(cells.length > 1 ? cells.slice(1).join(", ") : cells[0], 600);
      if (!see) continue;
      const id = (picIds[pic] ||= randomUUID()); pic++;
      // Optional third cell: a camera hint such as "pov" or "wide".
      const see2 = text(cells.length > 2 ? cells[1] : see, 600);
      plan.shots.push({ at: "", who: cells.length > 1 ? nameList(cells[0]) : [], see: cells.length > 2 ? see2 : see, pos, id, ...(cells.length > 2 ? { hint: cells[2] } : {}) });
    } else if (marker.kind === "new" && cells[0] && cells[1]) {
      plan.people.push({ name: text(cells[0], 120), look: text(cells[1], 600), clothes: text(cells[2], 400) });
    } else if (marker.kind === "wear" && cells[0] && cells[1]) {
      plan.outfits.push({ name: text(cells[0], 120), clothes: normalizeOutfit(text(cells[1], 400)), at: "", pos });
    } else if (marker.kind === "place" && cells.join(", ").trim()) {
      plan.places.push({ name: scene.location, look: text(cells.join(", "), 400) });
    }
  }
  return plan;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
/** Inline lines win; the director fills what they missed. */
export function mergePlans(inline: DirectorPlan, directed: DirectorPlan | null): DirectorPlan {
  if (!directed) return inline;
  return {
    question: directed.question, choices: directed.choices,
    people: [...inline.people, ...directed.people.filter((p) => !inline.people.some((q) => same(p.name, q.name)))],
    places: [...inline.places, ...directed.places.filter((p) => !inline.places.some((q) => same(p.name, q.name)))],
    // Both: the director's frames only fill lines the narrator left without one.
    shots: [...inline.shots, ...directed.shots],
    outfits: [...inline.outfits, ...directed.outfits.filter((o) => !inline.outfits.some((q) => same(o.name, q.name)))]
  };
}

/** Lines per picture the reader should get, capped by the per-scene limit. */
export const LINES_PER_PICTURE = 5;
/** Scenes with fewer pictures than that: the narrator marked too few. */
export function sparseScenes(story: NovelStory, count: number, plan: DirectorPlan) {
  return story.scenes.slice(-count).map((scene, i) => {
    const wanted = Math.min(story.config.imagesPerScene, Math.max(1, Math.ceil(scene.lines.length / LINES_PER_PICTURE)));
    return plan.shots.filter((shot) => shot.pos?.scene === i).length < wanted ? i : -1;
  }).filter((i) => i >= 0);
}

/** People in this turn's pictures (in layers mode: everyone who speaks, for
 * their sprite) who cannot be drawn consistently yet: unknown, without a short
 * English picture look, or without known clothes. The narrator seen through
 * their own eyes is not drawn and needs nothing. Names match as written or by
 * first name; "me" is the protagonist. */
export function peopleToDescribe(story: NovelStory, count: number, plan: DirectorPlan, layers: boolean) {
  const hero = protagonistCharacter(story);
  const given = (name: string) => plan.people.some((p) => same(p.name, name) && p.look);
  const find = (name: string) => story.memory.characters.find((c) => same(c.name, name) || same(c.name.split(/\s+/)[0], name) || same(c.name, name.split(/\s+/)[0]))
    || (hero && (same(hero.name, name) || isViewerWord(name)) ? hero : undefined);
  const needed = layers
    ? story.scenes.slice(-count).flatMap((scene) => scene.lines.map((line) => line.speaker.trim()))
    : plan.shots.flatMap((shot) => inferCamera(story, shot) === "first-person" || shot.camera === "first-person" ? shot.who.filter((name) => !isViewerWord(name) && !(hero && same(hero.name, name))) : shot.who);
  const last = story.scenes.at(-1);
  const names = needed.filter((name) => name && !/^(?:none|nobody|no one)$/i.test(name)).map((name) => isViewerWord(name) && hero ? hero.name : name);
  return [...new Set(names.filter((name) => {
    if (given(name)) return false;
    const person = find(name);
    return !person || !hasPictureLook(person) || !knownOutfit(person, last);
  }))];
}

/** Picture lines for a turn as it was finally drawn: every frame as [pic],
 * plus the [new]/[wear]/[place] facts the narrator wrote or the director
 * supplied. Replayed in history after a follow-up ran, so the next turn sees
 * the format in use instead of its own reply without it. */
export function replayMarkers(final: NovelStory, before: NovelStory, count: number, written: LiteMarker[]): LiteMarker[] {
  const scenes = final.scenes.slice(-count), memory = final.memory.characters;
  const nameOf = (id: string) => memory.find((c) => c.id === id)?.name || "";
  const markers: LiteMarker[] = written.filter((m) => m.kind !== "pic");
  const lineMentioning = (name: string) => {
    const first = name.toLocaleLowerCase().split(/\s+/)[0];
    for (let s = 0; s < scenes.length; s++) {
      const line = scenes[s].lines.findIndex((l) => l.speaker.toLocaleLowerCase().startsWith(first) || l.text.toLocaleLowerCase().includes(first));
      if (line >= 0) return { scene: s, line };
    }
    return { scene: 0, line: 0 };
  };
  // People the director described (the narrator's own [new] lines are kept above).
  for (const person of memory) {
    if (before.memory.characters.some((c) => c.id === person.id) || markers.some((m) => m.kind === "new" && same(m.cells[0], person.name))) continue;
    markers.push({ kind: "new", ...lineMentioning(person.name), cells: [person.name, person.appearance || person.description, person.outfit || ""].filter((cell, i) => cell || i < 2) });
  }
  scenes.forEach((scene, s) => {
    const previous = s ? scenes[s - 1].visuals : before.scenes.at(-1)?.visuals;
    if (scene.visuals?.setting && scene.visuals.setting !== scene.location && scene.visuals.setting !== previous?.setting && !markers.some((m) => m.kind === "place" && m.scene === s))
      markers.push({ kind: "place", scene: s, line: 0, cells: [scene.visuals.setting] });
    for (const [id, outfit] of Object.entries(scene.visuals?.outfits || {})) {
      const name = nameOf(id), was = previous?.outfits[id] || before.memory.characters.find((c) => c.id === id)?.outfit;
      if (!name || !was || was === outfit || markers.some((m) => m.kind === "wear" && m.scene === s && same(m.cells[0], name))) continue;
      const at = scenes[s].lines.findIndex((l) => l.text.toLocaleLowerCase().includes(name.toLocaleLowerCase().split(/\s+/)[0]));
      markers.push({ kind: "wear", scene: s, line: Math.max(0, at), cells: [name, outfit] });
    }
    for (const frame of scene.illustrations) {
      const who = frame.characterIds.map(nameOf).filter(Boolean);
      markers.push({ kind: "pic", scene: s, line: frame.atLine, cells: [who.length ? who.join(", ") : "none", frame.prompt] });
    }
  });
  // Facts before the picture that uses them, as the prompt example shows.
  const order = { place: 0, new: 1, wear: 2, pic: 3 } as const;
  return markers.sort((a, b) => a.scene - b.scene || a.line - b.line || Number(Boolean(a.after)) - Number(Boolean(b.after)) || order[a.kind] - order[b.kind]);
}
