import {expect,it} from 'vitest';
import {DEFAULT_NOVEL_CONFIG} from '../../../src/shared/types/novels.js';
import {novelResponseFormat} from './responseSchema.js';
import {normalizeConfig} from './normalize.js';
const provider={id:'lm-studio',name:'LM Studio',base_url:'http://127.0.0.1:1234/v1',api_key_cipher:'',provider_type:'openai'};
it('automatically enables LM Studio on named profiles and remote/default-port endpoints',()=>{
 expect(novelResponseFormat(DEFAULT_NOVEL_CONFIG,provider)?.type).toBe('json_schema');
 expect(novelResponseFormat(DEFAULT_NOVEL_CONFIG,{...provider,id:'generic',name:'Local',base_url:'http://192.0.2.1:1234/v1'})?.type).toBe('json_schema');
 expect(novelResponseFormat(DEFAULT_NOVEL_CONFIG,{...provider,base_url:'http://192.0.2.1:9000/v1'})?.type).toBe('json_schema');
 expect(novelResponseFormat(DEFAULT_NOVEL_CONFIG,{...provider,id:'other',name:'Other',base_url:'https://provider.example/v1'})).toBeUndefined();
 expect(novelResponseFormat({...DEFAULT_NOVEL_CONFIG,structuredOutput:'off'},provider)).toBeUndefined();
 expect(novelResponseFormat({...DEFAULT_NOVEL_CONFIG,structuredOutput:'json_schema'},{...provider,provider_type:'koboldcpp'})).toBeUndefined();
 expect(novelResponseFormat({...DEFAULT_NOVEL_CONFIG,structuredOutput:'json_schema'},{...provider,id:'other',name:'Other',base_url:'https://provider.example/v1'})?.type).toBe('json_schema');
});
it('constrains essential prose/cast/cuts while keeping unchanged metadata optional',()=>{
 const format=novelResponseFormat({...DEFAULT_NOVEL_CONFIG,imagesEnabled:true,imagesPerScene:3,scenesPerTurn:20,questionFrequency:'off'},provider)!;
 const schema=format.json_schema.schema as any;
 expect(schema.required).toEqual(['scenes']);expect(schema.additionalProperties).toBe(false);
 const scene=schema.properties.scenes.items;
 expect(schema.properties.scenes.maxItems).toBe(20);expect(scene.required).toEqual(['lines']);
 expect(scene.properties.lines.minItems).toBe(1);expect(scene.properties.lines.items.anyOf[0].type).toBe('string');expect(scene.properties.lines.items.anyOf[1].required).toEqual(['text']);
 expect(scene.properties.illustrations.maxItems).toBe(3);expect(scene.properties.illustrations.items.required).toEqual(['prompt','characterIds','camera']);
 expect(scene.properties.locationChange.type).toBe('integer');expect(scene.properties.outfitChanges.additionalProperties.type).toBe('integer');
 expect(schema.properties.characters.items.properties.members.items.required).toEqual(['id','name']);
 expect(schema.properties).not.toHaveProperty('summary');
 const plain=novelResponseFormat({...DEFAULT_NOVEL_CONFIG,imagesEnabled:false,questionFrequency:'off'},provider)!.json_schema.schema as any;
 expect(plain.properties.scenes.items.properties).not.toHaveProperty('illustrations');expect(plain.properties.scenes.items.properties).not.toHaveProperty('choices');
});
it('normalizes old/malformed configuration to automatic without overwriting other fields',()=>{
 expect(normalizeConfig({premise:'Synthetic',structuredOutput:'invalid'})).toMatchObject({premise:'Synthetic',structuredOutput:'auto'});
 expect(normalizeConfig({structuredOutput:'json_schema'}).structuredOutput).toBe('json_schema');expect(normalizeConfig({structuredOutput:'off'}).structuredOutput).toBe('off');
});
it('requires an explicit per-image camera for dynamic images and keeps fixed-camera fields optional',()=>{
 const dynamic=novelResponseFormat({...DEFAULT_NOVEL_CONFIG,imagesEnabled:true,imagePov:'dynamic'},provider)!.json_schema.schema as any;
 const shot=dynamic.properties.scenes.items.properties.illustrations.items;
 expect(shot.required).toContain('camera');expect(shot.properties.camera.enum).toContain('over-shoulder');
 const fixed=novelResponseFormat({...DEFAULT_NOVEL_CONFIG,imagesEnabled:true,imagePov:'third'},provider)!.json_schema.schema as any;
 expect(fixed.properties.scenes.items.properties.illustrations.items.required).not.toContain('camera');
 expect(normalizeConfig({pov:'first'})).toMatchObject({pov:'first',imagePov:'dynamic'});
});
