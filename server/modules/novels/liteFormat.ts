/** Line-based story format for models that cannot hold a JSON contract.
 * Parsing is total: any non-empty reply becomes readable scenes. A line that
 * matches no rule is narration, so a model ignoring the format still yields a
 * story instead of a rejected turn. */
export interface LiteLine { speaker: string; text: string }
export interface LiteScene { location: string; lines: LiteLine[] }
/** A technical line for pictures, never shown to the reader. It belongs to
 * the story line that follows it (`after` when nothing follows). */
export interface LiteMarker { kind: "pic" | "new" | "wear" | "place"; scene: number; line: number; after?: boolean; cells: string[] }
export interface LiteBatch { scenes: LiteScene[]; question: string; choices: string[]; markers: LiteMarker[] }
const MARKER = /^\[\s*(pic|picture|image|new|wear|outfit|clothes|place)\s*[:：\-]\s*(.*?)\s*\]?\s*$/i;
const MARKER_KIND: Record<string, LiteMarker["kind"]> = { pic: "pic", picture: "pic", image: "pic", new: "new", wear: "wear", outfit: "wear", clothes: "wear", place: "place" };
export const markerText = (marker: Pick<LiteMarker, "kind" | "cells">) => `[${marker.kind}: ${marker.cells.join(" | ")}]`;

export const LITE_MAX_SCENE_LINES = 40;
const MAX_SCENES = 20;
const unwrap = (value: string) => value.replace(/^(?:\*\*|__|[*_`])+|(?:\*\*|__|[*_`])+$/g, "").trim();
const unquote = (value: string) => /^["“«„].*["”»“]$/u.test(value) && value.length > 2 ? value.slice(1, -1).trim() : value;

/** `Name: words` is speech only when the prefix can be a name. Known cast
 * names always qualify; unknown ones need to look like a short proper name so
 * narration such as "He said: ..." is left intact. */
function speakerName(prefix: string, known: Set<string>): string {
  const name = unwrap(prefix.replace(/\([^)]*\)\s*$/, "").replace(/^\[|\]$/g, "")).trim();
  if (!name || name.length > 40) return "";
  if (known.has(name.toLocaleLowerCase())) return name;
  if (/[.,!?;…"“”«»]|\s[-–—]\s/u.test(name)) return "";
  const words = name.split(/\s+/);
  if (words.length > 3) return "";
  const cased = /\p{Lu}|\p{Ll}/u.test(name);
  if (!cased) return /\p{L}/u.test(name) && name.length <= 16 ? name : "";
  return words.every((word) => /^\p{Lu}/u.test(word) || /^(?:de|van|von|la|the|of)$/i.test(word)) ? name : "";
}

export function parseLiteText(raw: string, knownNames: string[] = []): LiteBatch {
  if (raw.length > 500000) throw new Error("Model response exceeds the novel limit");
  const known = new Set(knownNames.map((name) => name.trim().toLocaleLowerCase()).filter(Boolean));
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "");
  const scenes: LiteScene[] = [];
  let current: LiteScene = { location: "", lines: [] };
  let question = ""; const choices: string[] = []; let deciding = false;
  const markers: LiteMarker[] = [];
  let pending: Array<Pick<LiteMarker, "kind" | "cells">> = [];
  const flush = () => { if (current.lines.length) scenes.push(current); };
  for (const source of clean.split(/\r?\n/)) {
    const line = source.trim();
    if (!line || /^(?:```.*|[-*_=~]{3,})$/.test(line)) continue;
    const choice = /^>\s*(.+)$/.exec(line) || (deciding ? /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line) : null);
    if (choice) { deciding = true; const value = unquote(unwrap(choice[1])).slice(0, 300); if (value && choices.length < 4) choices.push(value); continue; }
    const asked = /^\?\s*(.+)$/.exec(line);
    if (asked && !deciding) { deciding = true; question = unwrap(asked[1]).slice(0, 1000); continue; }
    // The decision ends the batch: never keep prose that answers for the reader.
    if (deciding) continue;
    const marker = MARKER.exec(line);
    if (marker) {
      const cells = marker[2].split("|").map((cell) => unwrap(cell).slice(0, 600)).filter((cell, i) => cell || i > 0).slice(0, 4);
      if (cells.some(Boolean)) pending.push({ kind: MARKER_KIND[marker[1].toLowerCase()], cells });
      continue;
    }
    const header = /^#{1,6}\s*(.*)$/.exec(line);
    if (header) {
      const place = unwrap(header[1].replace(/#+\s*$/, "")).replace(/^(?:scene|сцена|chapter|глава)\s*\d*\s*[:.\-–—]?\s*/i, "").slice(0, 200);
      if (current.lines.length) { flush(); current = { location: place || current.location, lines: [] }; }
      else if (place) current.location = place;
      continue;
    }
    const speech = /^(.{1,60}?)\s*[:：]\s*(.+)$/u.exec(line);
    const speaker = speech ? speakerName(speech[1], known) : "";
    const text = (speaker ? unquote(unwrap(speech![2])) : unwrap(line)).slice(0, 2000);
    if (!text) continue;
    if (current.lines.length >= LITE_MAX_SCENE_LINES) { flush(); current = { location: current.location, lines: [] }; }
    for (const item of pending) markers.push({ ...item, scene: scenes.length, line: current.lines.length });
    pending = [];
    current.lines.push({ speaker, text });
  }
  flush();
  if (!scenes.length) throw new Error("The model returned no story text");
  // Lines after the last story line still describe it.
  const last = Math.min(scenes.length, MAX_SCENES) - 1;
  for (const item of pending) markers.push({ ...item, scene: last, line: scenes[last].lines.length - 1, after: true });
  return { scenes: scenes.slice(0, MAX_SCENES), question, choices: choices.length >= 2 ? choices : [], markers: markers.filter((m) => m.scene <= last) };
}

/** Canonical rendering of saved scenes. History is always sent in this exact
 * shape, so the model sees the format obeyed even where its own reply strayed,
 * and identical bytes keep the provider's prompt cache valid. */
export function renderLiteScenes(scenes: Array<{ location: string; lines: LiteLine[]; question?: string; choices?: string[] }>, previousLocation = "", markers: LiteMarker[] = []): string {
  const out: string[] = []; let location = previousLocation;
  scenes.forEach((scene, s) => {
    if (scene.location && scene.location !== location) { out.push(`## ${scene.location}`); location = scene.location; }
    scene.lines.forEach((line, l) => {
      for (const marker of markers) if (marker.scene === s && marker.line === l && !marker.after) out.push(markerText(marker));
      const text = line.text.replace(/\s*\n+\s*/g, " ");
      out.push(line.speaker ? `${line.speaker}: ${text}` : text);
      for (const marker of markers) if (marker.scene === s && marker.line === l && marker.after) out.push(markerText(marker));
    });
    if (scene.question) out.push(`? ${scene.question}`);
    for (const choice of scene.choices || []) out.push(`> ${choice}`);
  });
  return out.join("\n");
}
