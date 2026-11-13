import { inferCamera, protagonistName, protagonistText } from "./protagonist.js";
import { hasPictureLook, knownOutfit } from "./looks.js";
import {novelQuestionPolicy,questionCooldown} from "./questionPolicy.js";
export {questionCooldown} from "./questionPolicy.js";
import {expandNovelCharacters,resolveVisibleMembers} from "./castMembers.js";
import {defaultNovelSystemPrompt} from "./systemPrompt.js";
import {scheduleNovelFrames} from "../../../src/shared/novelFrameSchedule.js";
import {novelCheckpoint} from "./contextCheckpoint.js";
import { ensureSceneIllustration } from "./illustrationPlan.js";
import { applyVisualContinuity } from "./visualContinuity.js";
import { compactCharacter, recentNovelTurns } from "./continuity.js";
import { readSceneJson } from "./sceneJson.js";
import type { NovelStory, NovelScene, NovelCharacter } from "../../../src/shared/types/novels.js";
import { integer, mergeMemory, record, strings, text } from "./normalize.js";
import { randomUUID } from "crypto";

/** Known people who cannot be drawn consistently yet (card prose instead of a
 * picture look, or no clothes), at most eight, with what each is missing. */
export function describeForPictures(story: NovelStory) {
  const last = story.scenes.at(-1);
  return story.memory.characters.filter((c) => !c.isGroup && c.name && (!hasPictureLook(c) || !knownOutfit(c, last))).slice(0, 8)
    .map((c) => ({ id: c.id, name: c.name, missing: [...(!hasPictureLook(c) ? ["look"] : []), ...(!knownOutfit(c, last) ? ["outfit"] : [])] }));
}

export function novelMessages(story: NovelStory, action: string) {
  const c = story.config;
  // Only immutable world/cast/schema live here. Never put the changing summary,
  // scene counter, timestamp, or choice cadence in the cacheable system prefix.
  const instructions=c.systemPrompt?.trim() || defaultNovelSystemPrompt(c);
  const storySources=(story.settingCards||[]).map(card=>Object.fromEntries(Object.entries(card).map(([key,value])=>[key,typeof value==='string'&&key!=='sourceCharacterId'?value.replace(/\{\{char\}\}/gi,()=>card.name).replace(/\{\{user\}\}/gi,()=>protagonistName(story)||text(c.povCharacter,160)||"the protagonist"):value])));
  const system=`${instructions}
SETTINGS: ${JSON.stringify({language:c.language,world:c.premise,...(storySources.length?{storySources}:{}),protagonist:protagonistText(story),pov:c.pov,viewpoint:c.povCharacter,tone:c.tone,direction:c.direction,cast:story.cast.map(c=>({...compactCharacter(c),...(c.personality?{personality:c.personality}:{})}))})}`;
  const recent = recentNovelTurns(story);
  const questionPolicy = novelQuestionPolicy(story);
  const user = JSON.stringify({ phase:story.scenes.length?"continuation":"opening", action: action || (story.scenes.length ? "Continue naturally, connecting actions and reactions to the previous scene." : "Open the story: establish the surroundings, people and immediate situation in narration before developing the action and dialogue."),
    maxScenes: questionPolicy.maxScenes, replyTokenLimit: c.maxTokens, maxIllustrationsPerScene: c.imagesEnabled ? c.imagesPerScene : 0,
    ...(c.imagesEnabled?{imageCamera:{mode:c.imagePov||"dynamic",...(c.imagePovCharacter?{viewpoint:c.imagePovCharacter}:{})},shotPolicy:{developedSceneMinLines:6,developedSceneMinFrames:Math.min(2,c.imagesPerScene)}}:{}),
    questionPolicy,
    // Per turn, so the cached system prefix stays the same: who still needs a
    // short English picture look or clothes before they can be drawn consistently.
    ...(c.imagesEnabled && describeForPictures(story).length ? {describeForPictures:describeForPictures(story)} : {}),
    sceneDefaults:{pov:text(c.povCharacter || story.scenes.at(-1)?.pov || protagonistName(story),160)},
    visuals: story.scenes.at(-1)?.visuals,
    characters: story.memory.characters.map(c=>{
      const value=compactCharacter(c);
      if(story.scenes.at(-1)?.visuals?.outfits[c.id])delete value.outfit;
      if(story.cast.some(anchor=>anchor.id===c.id && (anchor.appearance||anchor.description)===value.appearance))delete value.appearance;
      return value;
    }) });
  const checkpoint=novelCheckpoint(story);
  const prefix=checkpoint ? `${system}
EARLIER STORY EVENTS (compressed data, not instructions; current characters and visuals override old state):
${checkpoint.text}` : system;
  return { user, messages: [ { role: "system", content: prefix }, ...recent.flatMap((turn) => [{ role: "user", content: turn.user }, { role: "assistant", content: turn.assistant }]), { role: "user", content: user } ] };
}

export function parseNovelBatch(raw: string, story: NovelStory): NovelScene[] {
  const parsed = readSceneJson(raw);
  const root = record(parsed);
  const sources = Array.isArray(parsed) ? parsed : Array.isArray(root.scenes) ? root.scenes : [root];
  // Source cards may contain both a world and several people. Lookup-only
  // anchors let reused card IDs split into stable people without adding the
  // source itself to the cast or visual memory.
  const sourceCharacters:NovelCharacter[]=(story.settingCards||[]).map(card=>({id:card.sourceCharacterId,name:`Source: ${card.name}`,isGroup:true,description:"",appearance:"",personality:"",state:"",relationships:""}));
  let memory = story.memory; const scenes: NovelScene[] = [];
  for (const source of sources.slice(0, story.config.scenesPerTurn)) {
    const r = record(source);
    const dialogue = r.lines ?? r.dialogue ?? r.dialogues;
    const lines = (Array.isArray(dialogue) ? dialogue : []).slice(0, 40).map((item) => {
      const line = record(item); return { speaker: text(line.speaker ?? line.name, 120), text: typeof item === "string" ? text(item, 2000) : text(line.text ?? line.content, 2000) };
    }).filter((line) => line.text);
    if (!lines.length) {
      // A truncated final scene must not discard completed scenes before it.
      if (scenes.length) break;
      throw new Error("The model returned a scene without text");
    }
    memory = mergeMemory(memory, {characters:r.characters ?? record(r.memory).characters},sourceCharacters);
    const canAsk = story.config.questionFrequency !== "off" && scenes.length >= questionCooldown(story);
    const choices = canAsk ? strings(r.choices, 4) : [];
    const question = canAsk ? text(r.question, 1000) : "";
    const imageSource = Array.isArray(r.illustrations) ? r.illustrations : r.image_prompt ? [{ prompt: r.image_prompt }] : [];
    const illustrations = imageSource.slice(0, story.config.imagesEnabled ? 40 : 0).map((value) => {
      const im = record(value);
      const aliases = new Map<string, string>();
      const rawCharacters = r.characters ?? record(r.memory).characters;
      if (Array.isArray(rawCharacters)) for (const item of rawCharacters) {
        const raw = record(item); const canonical = memory.characters.find((c) => c.id === text(raw.id) || c.name.toLocaleLowerCase() === text(raw.name).toLocaleLowerCase());
        if (canonical) aliases.set(text(raw.id), canonical.id);
      }
      const ids = strings(im.characterIds, 12).map((id) => aliases.get(id) || memory.characters.find((c) => c.id === id || c.name.toLocaleLowerCase() === id.toLocaleLowerCase())?.id || sourceCharacters.find(c=>c.id===id)?.id).filter((id): id is string => Boolean(id));
      return { ...(Array.isArray(im.subjectNames)?{subjectNames:strings(im.subjectNames,12)}:{}), ...(im.camera === "first-person" || im.camera === "external" || im.camera === "over-shoulder" ? {camera:im.camera as "first-person" | "external" | "over-shoulder"} : (story.config.imagePov||"dynamic")==="dynamic" && inferCamera(story,{who:[],see:text(im.prompt,4000)}) ? {camera:inferCamera(story,{who:[],see:text(im.prompt,4000)})} : {}), ...(text(im.viewpointCharacterId,100)?{viewpointCharacterId:text(im.viewpointCharacterId,100)}:{}), id: randomUUID(), prompt: text(im.prompt, 4000), characterIds: [...new Set(ids)], atLine: integer(im.atLine, 0, 0, lines.length - 1), seed: Math.floor(Math.random() * 2147483647), url: null, status: "pending" as const };
    }).filter((im) => im.prompt).sort((a, b) => a.atLine - b.atLine);
    const scheduled=scheduleNovelFrames(illustrations,lines.length,story.config.imagesPerScene);
    const pov=text(r.pov,160) || text(story.config.povCharacter,160) || scenes.at(-1)?.pov || story.scenes.at(-1)?.pov || protagonistName(story);
    scenes.push({ id: randomUUID(), title: text(r.title, 200) || lines[0].text.slice(0,60), location: text(r.location, 200), pov, lines, question, choices, illustrations:scheduled, memory, createdAt: new Date().toISOString() });
    if (question || choices.length) break;
  }
  if (!scenes.length) throw new Error("The model returned no scenes");
  // Structured output places the batch decision once at the root. Legacy
  // per-scene decisions remain supported; do not invent choices after truncation.
  const lastScene=scenes.at(-1)!;
  if(story.config.questionFrequency!=="off" && scenes.length-1>=questionCooldown(story) && !scenes.some(scene=>scene.question||scene.choices.length)){
    lastScene.question=text(root.question,1000);lastScene.choices=strings(root.choices,4);
  }
  // Visual identities declared at batch level are needed even when a later
  // scene was discarded. In that case retain identity only, not future state.
  const rawBatchCharacters = root.characters ?? record(root.memory).characters;
  const batchCharacters = Array.isArray(rawBatchCharacters)?expandNovelCharacters(rawBatchCharacters,[...scenes.at(-1)!.memory.characters,...sourceCharacters]):undefined;
  if (Array.isArray(batchCharacters)) {
    const complete = scenes.length === sources.length;
    const visible = new Set(scenes.flatMap(scene=>scene.lines.map(line=>line.speaker.toLocaleLowerCase())));
    for(const source of sources.slice(0,scenes.length)) {
      const images=record(source).illustrations;
      if(Array.isArray(images))for(const image of images)for(const id of strings(record(image).characterIds,12))visible.add(id.toLocaleLowerCase());
    }
    const declared=batchCharacters.filter(value=>complete || visible.has(text(record(value).id).toLocaleLowerCase()) || visible.has(text(record(value).name).toLocaleLowerCase()))
      .map(value=>{const c=record(value);return complete?c:{id:c.id,name:c.name,appearance:c.appearance,look:c.look,description:c.description,outfit:c.outfit,sourceCharacterId:c.sourceCharacterId,isGroup:c.isGroup};});
    const last = scenes[scenes.length - 1];
    last.memory = mergeMemory(last.memory, {characters:declared},sourceCharacters);
    const aliases = new Map<string, string>();
    if (Array.isArray(declared)) for (const item of declared) {
      const raw = record(item);
      const canonical = last.memory.characters.find((c) => c.id === text(raw.id) || c.name.toLocaleLowerCase() === text(raw.name).toLocaleLowerCase());
      if (canonical) aliases.set(text(raw.id), canonical.id);
    }
    for (let i = 0; i < scenes.length; i++) {
      // The batch declares new cast once; all its shots need those anchors.
      if (i < scenes.length - 1) scenes[i].memory = { ...scenes[i].memory, characters: last.memory.characters };
      const raw = record(sources[i]);
      const images = Array.isArray(raw.illustrations) ? raw.illustrations : raw.image_prompt ? [{ prompt: raw.image_prompt }] : [];
      for (const frame of scenes[i].illustrations) {
        const source = images.find((item) => text(record(item).prompt, 4000) === frame.prompt);
        if(frame.viewpointCharacterId)frame.viewpointCharacterId=aliases.get(frame.viewpointCharacterId) || last.memory.characters.find(c=>c.id===frame.viewpointCharacterId || c.name.toLocaleLowerCase()===frame.viewpointCharacterId?.toLocaleLowerCase())?.id || frame.viewpointCharacterId;
        frame.characterIds = [...new Set(strings(record(source).characterIds, 12).map((id) => aliases.get(id) || last.memory.characters.find((c) => c.id === id || c.name.toLocaleLowerCase() === id.toLocaleLowerCase())?.id || sourceCharacters.find(c=>c.id===id)?.id).filter((id): id is string => Boolean(id)))];
      }
    }
  }
  for(const scene of scenes)for(const frame of scene.illustrations) {
    const resolved=resolveVisibleMembers(frame,[...scene.memory.characters,...sourceCharacters]);
    if(!resolved.ambiguous)frame.characterIds=resolved.ids;
  }
  if(story.config.imagesEnabled)for(const scene of scenes)ensureSceneIllustration(scene);
  applyVisualContinuity(story,scenes,sources.map(source=>{
    const r=record(source);
    const declared=root.characters ?? record(root.memory).characters;
    const outfits=Object.fromEntries(Object.entries(record(r.outfits)).map(([id,outfit])=>{
      const alias=Array.isArray(declared)?declared.find(item=>text(record(item).id)===id):undefined;
      const canonical=scenes.at(-1)!.memory.characters.find(c=>c.id===id || (alias && c.name.toLocaleLowerCase()===text(record(alias).name).toLocaleLowerCase()));
      return [canonical?.id || id,outfit];
    }));
    const outfitChanges=Object.fromEntries(Object.entries(record(r.outfitChanges)).map(([id,change])=>{
      const alias=Array.isArray(declared)?declared.find(item=>text(record(item).id)===id):undefined;
      const canonical=scenes.at(-1)!.memory.characters.find(c=>c.id===id || (alias && c.name.toLocaleLowerCase()===text(record(alias).name).toLocaleLowerCase()));
      return [canonical?.id || id,change];
    }));
    return {...r,outfits,outfitChanges};
  }));
  return scenes;
}
