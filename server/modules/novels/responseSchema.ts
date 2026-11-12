import {novelQuestionPolicy} from "./questionPolicy.js";
import type {NovelConfig} from "../../../src/shared/types/novels.js";
import type {UnifiedProviderRow,UnifiedResponseFormat} from "../../services/unifiedGeneration.js";
import {normalizeProviderType} from "../../services/providerApi.js";
const string={type:"string"};
const index={type:"integer",minimum:0,maximum:39};
const strings={type:"array",items:string};
const object=(properties:Record<string,unknown>,required:string[]=[])=>({type:"object",properties,required,additionalProperties:false});
export function novelResponseFormat(config:NovelConfig,provider:UnifiedProviderRow,questionPolicy=novelQuestionPolicy({config,scenes:[]})):UnifiedResponseFormat|undefined {
  if(config.structuredOutput==='off'||normalizeProviderType(provider.provider_type)!=='openai')return;
  let standardPort=false;try{standardPort=new URL(provider.base_url).port==='1234';}catch{/* URL validation is handled by generation. */}
  const lmStudio=/lm[\s_-]*studio/i.test(provider.id+' '+provider.name)||standardPort;
  if(config.structuredOutput!=='json_schema'&&!lmStudio)return;
  const person={id:string,name:string,sourceCharacterId:string,isGroup:{type:'boolean'},appearance:string,outfit:string,state:string,relationships:string};
  const character=object({...person,members:{type:'array',items:object(person,['id','name']),maxItems:20}},['id']);
  const shot=object({prompt:{type:'string',minLength:1},characterIds:{...strings,maxItems:12},subjectNames:{...strings,maxItems:12},atLine:index,camera:{type:'string',enum:['external','first-person','over-shoulder']},viewpointCharacterId:string},['prompt','characterIds',...((config.imagePov||'dynamic')==='dynamic'?['camera']:[])]);
  const scene=object({
    lines:{type:'array',minItems:1,maxItems:40,items:{anyOf:[{type:'string',minLength:1},object({speaker:string,text:{type:'string',minLength:1}},['text'])]}},
    title:string,location:string,pov:string,
    ...(config.imagesEnabled?{setting:string,illustrations:{type:'array',items:shot,maxItems:config.imagesPerScene},outfits:{type:'object',additionalProperties:string},outfitChanges:{type:'object',additionalProperties:index}}:{}),
    locationChange:index
  },['lines']);
  return {type:'json_schema',json_schema:{name:'novel_scene_batch',strict:true,schema:object({characters:{type:'array',items:character,maxItems:40},scenes:{type:'array',items:scene,minItems:questionPolicy.required?questionPolicy.earliestSceneOffset+1:1,maxItems:questionPolicy.maxScenes},...(questionPolicy.required?{question:{type:'string',minLength:1},choices:{...strings,minItems:2,maxItems:4}}:{})},['scenes',...(questionPolicy.required?['question','choices']:[])])}};
}
