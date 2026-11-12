import {afterEach,expect,it,vi} from 'vitest';
import {unifiedGenerateText,type UnifiedResponseFormat} from './unifiedGeneration.js';
afterEach(()=>vi.restoreAllMocks());
const format:UnifiedResponseFormat={type:'json_schema',json_schema:{name:'test',strict:true,schema:{type:'object',properties:{scenes:{type:'array'}},required:['scenes'],additionalProperties:false}}};
const params={provider:{id:'test',name:'Synthetic',base_url:'http://127.0.0.1:1234/v1',api_key_cipher:'test',provider_type:'openai'},modelId:'test',messages:[{role:'user',content:'Synthetic test'}],responseFormat:format,allowUnstructuredFallback:true};
const ok=()=>new Response(JSON.stringify({choices:[{message:{content:'{"scenes":[]}'}}]}),{headers:{'content-type':'application/json'}});
it('sends the schema through the OpenAI-compatible transport and leaves ordinary calls unchanged',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
 await unifiedGenerateText(params);expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).response_format).toEqual(format);
 await unifiedGenerateText({...params,responseFormat:undefined});expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).not.toHaveProperty('response_format');
});
it('falls back exactly once on an explicit schema rejection, preserving messages and sampling',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('Unsupported response_format json_schema',{status:400})).mockResolvedValueOnce(ok());
 await unifiedGenerateText(params);expect(fetch).toHaveBeenCalledTimes(2);
 const first=JSON.parse(String(fetch.mock.calls[0][1]?.body)),second=JSON.parse(String(fetch.mock.calls[1][1]?.body));
 const {response_format,...rest}=first;expect(response_format).toEqual(format);expect(second).toEqual(rest);
});
it('does not downgrade on auth/model errors or a successful but malformed answer',async()=>{
 for(const [status,body] of [[401,'Unauthorized response_format'],[400,'Unknown model'],[422,'Invalid temperature']] as const){
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(body,{status}));
  await expect(unifiedGenerateText(params)).rejects.toThrow(body);expect(fetch).toHaveBeenCalledTimes(1);fetch.mockRestore();
 }
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'invalid JSON'}}]})));
 expect((await unifiedGenerateText(params)).content).toBe('invalid JSON');expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not repeat a failed fallback or a schema request without fallback authorization',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('Invalid JSON schema',{status:400}));
 await expect(unifiedGenerateText(params)).rejects.toThrow('Invalid JSON schema');expect(fetch).toHaveBeenCalledTimes(2);
 fetch.mockClear();await expect(unifiedGenerateText({...params,allowUnstructuredFallback:false})).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});
