import {expect,it} from 'vitest';
import {DEFAULT_NOVEL_CONFIG,type NovelStory} from '../../../src/shared/types/novels.js';
import {novelQuestionPolicy} from './questionPolicy.js';
import {novelResponseFormat} from './responseSchema.js';
import {novelMessages,parseNovelBatch} from './prompts.js';
const provider={id:'lm-studio',name:'LM Studio',base_url:'http://localhost:1234/v1',api_key_cipher:'',provider_type:'openai'};
const story=():NovelStory=>({id:'synthetic',title:'Synthetic',config:{...DEFAULT_NOVEL_CONFIG,imagesEnabled:false},cast:[],memory:{summary:'',facts:[],threads:[],characters:[]},scenes:[],turns:[],cursor:{scene:0,line:0},revision:0,createdAt:'',updatedAt:'',cache:null});
it('schedules a required decision at the selected frequency rather than making all questions optional',()=>{
 for(const [frequency,interval] of [['frequent',1],['balanced',2],['rare',4]] as const){
  const draft=story();draft.config.questionFrequency=frequency;
  const plan=novelQuestionPolicy(draft);expect(plan).toMatchObject({required:true,maxScenes:interval,earliestSceneOffset:interval-1});
  const schema=novelResponseFormat(draft.config,provider,plan)!.json_schema.schema as any;
  expect(schema.required).toEqual(['scenes','question','choices']);expect(schema.properties.choices.minItems).toBe(2);expect(schema.properties.scenes.minItems).toBe(interval);expect(schema.properties.scenes.maxItems).toBe(interval);
 }
});
it('waits through small batches and resets the interval after answering a decision',()=>{
 const draft=story();draft.config.questionFrequency='rare';draft.config.scenesPerTurn=1;
 expect(novelQuestionPolicy(draft)).toMatchObject({required:false,maxScenes:1});
 draft.scenes=parseNovelBatch(JSON.stringify({scenes:[0,1,2].map(()=>({lines:['Synthetic scene.']}))}),{...draft,config:{...draft.config,scenesPerTurn:3}});
 expect(novelQuestionPolicy(draft)).toMatchObject({required:true,earliestSceneOffset:0});
 const decision=parseNovelBatch(JSON.stringify({scenes:[{lines:['Synthetic decision.']}],question:'Which path?',choices:['Observe','Ask']}),draft);
 expect(decision[0].choices).toEqual(['Observe','Ask']);draft.scenes.push(...decision);
 expect(novelQuestionPolicy(draft)).toMatchObject({required:false,earliestSceneOffset:3});
});
it('accepts a root-level decision while preserving narrative and arbitrary reader input',()=>{
 const draft=story();draft.config.questionFrequency='frequent';
 const scene=parseNovelBatch(JSON.stringify({scenes:[{lines:['Synthetic complete scene.']}],question:'What now?',choices:['Ask','Wait']}),draft)[0];
 expect(scene.question).toBe('What now?');expect(scene.choices).toEqual(['Ask','Wait']);
 draft.scenes=[scene];const input=JSON.parse(novelMessages(draft,'I inspect the telescope instead.').user);expect(input.action).toBe('I inspect the telescope instead.');expect(input.questionPolicy.required).toBe(true);
 draft.config.questionFrequency='off';expect(novelQuestionPolicy(draft).required).toBe(false);expect(JSON.parse(novelMessages(draft,'My own reply.').user).action).toBe('My own reply.');
 const schema=novelResponseFormat(draft.config,provider)!.json_schema.schema as any;expect(schema.required).toEqual(['scenes']);expect(schema.properties).not.toHaveProperty('choices');
});
