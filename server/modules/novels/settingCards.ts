import {db} from '../../db.js';
import {record,text} from './normalize.js';
import type {NovelSettingCard} from '../../../src/shared/types/novels.js';
/** Snapshots are server-owned. Reuse retained cards, even if their library
 * source was edited/deleted; only newly selected IDs are read from the library. */
export function snapshotSettingCards(ids:string[],previous:NovelSettingCard[]=[]):NovelSettingCard[]{
 return ids.map(id=>{
  const retained=previous.find(card=>card.sourceCharacterId===id);if(retained)return retained;
  const row=db.prepare('SELECT card_json FROM characters WHERE id = ?').get(id) as {card_json:string}|undefined;
  if(!row)throw Object.assign(new Error('Selected story foundation card no longer exists'),{status:400});
  const parsed=record(JSON.parse(row.card_json)),card=record(parsed.data||parsed);
  return {sourceCharacterId:id,name:text(card.name,120),
   ...Object.fromEntries(Object.entries({description:text(card.description,12000),scenario:text(card.scenario,8000),personality:text(card.personality,2000),instructions:text(card.system_prompt,4000),continuationInstructions:text(card.post_history_instructions,2000),opening:text(card.first_mes,3000),examples:text(card.mes_example,2000)}).filter(([,value])=>value))};
 });
}
export function hasNovelPremise(premise:string,cards:NovelSettingCard[]){return Boolean(premise.trim()||cards.some(card=>Object.entries(card).some(([key,value])=>key!=='name'&&key!=='sourceCharacterId'&&Boolean(value))));}
