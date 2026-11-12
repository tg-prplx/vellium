import { describe, expect, it } from "vitest";
import { patchNovelWorkflow } from "./workflow.js";
import { DEFAULT_NOVEL_CONFIG } from "../../../src/shared/types/novels.js";
const workflow = { "1": { class_type: "CLIPTextEncode", inputs: { text: "original" } }, "2": { class_type: "CLIPTextEncode", inputs: { text: "negative" } }, "3": { class_type: "KSampler", inputs: { seed: 1, cfg: 7, steps: 20, positive: ["1", 0], negative: ["2", 0] } }, "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } } };
describe("novel workflow patching", () => {
  it("finds conditioning nodes, changes shots/seed/dimensions and preserves the original graph and model parameters", () => {
    const g = patchNovelWorkflow(workflow, {...DEFAULT_NOVEL_CONFIG,overrideWorkflowSize:true,overrideWorkflowNegative:true}, "canonical appearance + shot", 123) as typeof workflow;
    expect(g["1"].inputs.text).toBe("canonical appearance + shot");
    expect(g["2"].inputs.text).toBe(DEFAULT_NOVEL_CONFIG.negativePrompt);
    expect(g["3"].inputs).toMatchObject({ seed: 123, cfg: 7, steps: 20 });
    expect(g["4"].inputs.width).toBe(1344);
    expect(workflow["1"].inputs.text).toBe("original");
  });
  it("preserves imported resolution, negative conditioning and secondary sampler parameters by default", () => {
    const imported={...workflow,"5":{class_type:"KSampler",inputs:{seed:42,cfg:3,steps:8}}};
    const result=patchNovelWorkflow(imported,DEFAULT_NOVEL_CONFIG,"shot",123) as typeof imported;
    expect(result["4"].inputs).toMatchObject({width:1344,height:768});
    expect(result["2"].inputs.text).toBe("negative");
    expect(result["5"]).toEqual(imported["5"]);
  });
  it("applies landscape dimensions only to the main sampler latent, including old square workflows",()=>{
    const graph={...workflow,"3":{...workflow["3"],inputs:{...workflow["3"].inputs,latent_image:["4",0]}},"9":{class_type:"EmptyLatentImage",inputs:{width:512,height:512}}};
    const result=patchNovelWorkflow(graph,{...DEFAULT_NOVEL_CONFIG,overrideWorkflowSize:false},"shot",123) as typeof graph;
    expect(result["4"].inputs).toMatchObject({width:1344,height:768});expect(result["9"].inputs).toMatchObject({width:512,height:512});
  });
  it("rejects editor graphs and overlapping text nodes", () => {
    expect(() => patchNovelWorkflow({ nodes: [] }, DEFAULT_NOVEL_CONFIG, "a", 0)).toThrow("API");
    expect(() => patchNovelWorkflow(workflow, { ...DEFAULT_NOVEL_CONFIG, positiveNode: "1", negativeNode: "1" }, "a", 0)).toThrow("different");
  });
});

it("reaches the correct conditioning through SamplerCustomAdvanced and CFGGuider",()=>{
 const graph={"1":{class_type:"CLIPTextEncode",inputs:{text:"positive"}},"2":{class_type:"CLIPTextEncode",inputs:{text:"negative"}},"3":{class_type:"CFGGuider",inputs:{positive:["1",0],negative:["2",0],cfg:4}},"4":{class_type:"RandomNoise",inputs:{noise_seed:1}},"5":{class_type:"EmptyAnimaLatentImage",inputs:{width:512,height:512}},"6":{class_type:"SamplerCustomAdvanced",inputs:{noise:["4",0],guider:["3",0],latent_image:["5",0]}},"7":{class_type:"RandomNoise",inputs:{noise_seed:999}}};
 const result=patchNovelWorkflow(graph,DEFAULT_NOVEL_CONFIG,"Anima shot",123) as typeof graph;
 expect(result["1"].inputs.text).toBe("Anima shot");expect(result["2"].inputs.text).toBe("negative");expect(result["4"].inputs.noise_seed).toBe(123);expect(result["5"].inputs).toMatchObject({width:1344,height:768});expect(result["7"].inputs.noise_seed).toBe(999);
});
it("supports BasicGuider conditioning without accidentally selecting CLIP/model text",()=>{
 const graph={"1":{class_type:"CLIPTextEncode",inputs:{text:"positive"}},"2":{class_type:"BasicGuider",inputs:{conditioning:["1",0]}},"3":{class_type:"SamplerCustomAdvanced",inputs:{guider:["2",0]}}};
 expect((patchNovelWorkflow(graph,DEFAULT_NOVEL_CONFIG,"shot",1) as typeof graph)["1"].inputs.text).toBe("shot");
});
