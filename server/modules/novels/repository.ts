import {normalizeNovelArtStyle} from "../../../src/shared/novelVisualDefaults.js";
import { db, newId, now } from "../../db.js";
import type { NovelStory, NovelSummary, NovelCharacter } from "../../../src/shared/types/novels.js";
import { integer, normalizeConfig, record, text } from "./normalize.js";

export function listNovels(): NovelSummary[] {
  // Return metadata only; listing books does not ship every saved scene to the renderer.
  return db.prepare(`SELECT id, title, updated_at AS updatedAt,
    json_array_length(payload, '$.scenes') AS sceneCount,
    (SELECT json_extract(frame.value, '$.url') FROM json_each(novels.payload, '$.scenes') AS scene,
      json_each(scene.value, '$.illustrations') AS frame
      WHERE json_extract(frame.value, '$.status') = 'ready' LIMIT 1) AS cover
    FROM novels ORDER BY updated_at DESC, id ASC`).all() as NovelSummary[];
}
export function getNovel(id: string): NovelStory {
  const row = db.prepare("SELECT payload, reading_cursor FROM novels WHERE id = ?").get(id) as { payload: string; reading_cursor: string | null } | undefined;
  if (!row) throw Object.assign(new Error("Novel not found"), { status: 404 });
  const story = JSON.parse(row.payload) as NovelStory;
  story.config.artStyle=normalizeNovelArtStyle(story.config.artStyle);
  if (row.reading_cursor) story.cursor = JSON.parse(row.reading_cursor);
  return story;
}
export function writeNovel(story: NovelStory, expectedRevision: number) {
  const next = { ...story, revision: expectedRevision + 1, updatedAt: now() };
  const result = db.prepare("UPDATE novels SET title = ?, payload = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?")
    .run(next.title, JSON.stringify(next), next.revision, next.updatedAt, next.id, expectedRevision);
  if (!result.changes) throw Object.assign(new Error("Novel changed; reload before retrying"), { status: 409 });
  return next;
}
export function createNovel(value: unknown): NovelStory {
  const input = record(value); const config = normalizeConfig(input.config);
  if (!config.premise) throw Object.assign(new Error("A premise is required"), { status: 400 });
  const cast: NovelCharacter[] = config.characterIds.map((id) => {
    const row = db.prepare("SELECT card_json FROM characters WHERE id = ?").get(id) as { card_json: string } | undefined;
    if (!row) throw Object.assign(new Error("Selected character no longer exists"), { status: 400 });
    const parsed = record(JSON.parse(row.card_json)); const c = record(parsed.data || parsed);
    return { id, sourceCharacterId: id, name: text(c.name, 120), description: text(c.description, 4000), appearance: text(c.description, 2000), personality: text(c.personality, 2000), state: "", relationships: "" };
  });
  const stamp = now();
  const story: NovelStory = { id: newId(), title: text(input.title, 160) || config.premise.slice(0, 60), config, cast,
    memory: { summary: "", facts: [], threads: [], characters: cast }, scenes: [], turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: stamp, updatedAt: stamp, cache: null };
  db.prepare("INSERT INTO novels (id, title, payload, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(story.id, story.title, JSON.stringify(story), 0, stamp, stamp);
  return story;
}
export function saveNovelProgress(id: string, value: unknown) {
  const story = getNovel(id); const input = record(value);
  const scene = integer(input.scene, 0, 0, Math.max(0, story.scenes.length - 1));
  const cursor = { scene, line: integer(input.line, 0, 0, Math.max(0, (story.scenes[scene]?.lines.length || 1) - 1)) };
  // Reading progress is independent of the generation revision, so a reader can
  // keep reading while frames are rendering without racing a narrative write.
  db.prepare("UPDATE novels SET reading_cursor = ? WHERE id = ?").run(JSON.stringify(cursor), id);
  return cursor;
}
export function deleteNovel(id: string) { db.prepare("DELETE FROM novels WHERE id = ?").run(id); }
