import type {NovelStory} from "../../../src/shared/types/novels.js";
export function novelCheckpoint(story:NovelStory) {
  const value=story.contextCheckpoint;
  if(!value || typeof value.text!=="string" || !value.text.trim() || value.text.length>1600 || !Number.isInteger(value.throughTurn) || value.throughTurn<0 || value.throughTurn>story.turns.length)return null;
  if(value.turnOffset!==undefined && (!Number.isInteger(value.turnOffset) || value.turnOffset<0 || value.throughTurn>=story.turns.length))return null;
  return value;
}
