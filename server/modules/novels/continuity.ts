import {novelCheckpoint} from "./contextCheckpoint.js";
import { readSceneJson } from "./sceneJson.js";
import type { NovelCharacter, NovelStory } from "../../../src/shared/types/novels.js";
import { record } from "./normalize.js";

export function compactCharacter(c: NovelCharacter) {
  return Object.fromEntries(Object.entries({ id:c.id, name:c.name, ...(c.sourceCharacterId?{sourceCharacterId:c.sourceCharacterId}:{}), ...(c.isGroup?{isGroup:true}:{}), appearance:c.appearance || c.description, outfit:c.outfit, state:c.state }).filter(([,v])=>v));
}
/** Project legacy turns without sending old summaries/facts/threads back to the model.
 * Projection is deterministic, so subsequent requests still reuse identical bytes. */
export function continuityTurn(raw: string) {
  try {
    const root=record(readSceneJson(raw));
    const {memory,...rest}=root;
    let sceneCharacters: unknown;
    if(Array.isArray(rest.scenes))rest.scenes=rest.scenes.map(value=>{
      const {memory:sceneMemory,...scene}=record(value);
      if(record(sceneMemory).characters)sceneCharacters=record(sceneMemory).characters;
      return scene;
    });
    if (!memory && !sceneCharacters) return raw;
    const characters=record(memory).characters ?? sceneCharacters;
    return JSON.stringify({...rest,...(Array.isArray(characters)?{characters:characters.map(c=>compactCharacter(c as NovelCharacter))}:{})});
  } catch { return raw; }
}
export function recentNovelTurns(story: NovelStory) {
  // Only a successfully persisted checkpoint can replace old turns. Never
  // silently drop an oversized turn before it has been summarized.
  const start=novelCheckpoint(story)?.throughTurn || 0;
  return story.turns.slice(start).map(turn=>({user:continuityTurn(turn.user),assistant:continuityTurn(turn.assistant)}));
}
