import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG } from "../../shared/types/novels";
import { firstNovelProblem, isNovelWorkflow, novelStepProblem } from "./setup";
const config = () => ({ ...DEFAULT_NOVEL_CONFIG, premise: "Synthetic story premise", providerId: "local-mock", modelId: "mock" });
describe("guided novel setup", () => {
  it("points to the first missing requirement rather than leaving a disabled action unexplained", () => {
    expect(firstNovelProblem(DEFAULT_NOVEL_CONFIG)).toEqual({ step: "story", problem: "novel.setup.needPremise" });
    expect(firstNovelProblem({ ...config(), providerId: "" })).toEqual({ step: "generation", problem: "novel.setup.needProvider" });
    expect(firstNovelProblem({ ...config(), modelId: " " })).toEqual({ step: "generation", problem: "novel.setup.needModel" });
  });
  it("allows an AI-generated cast and text-only story without any image server configuration", () => {
    expect(firstNovelProblem({ ...config(), comfyUrl: "", workflow: null, characterIds: [] })).toBeNull();
  });
  it("requires a real API workflow and safe endpoint only when illustrations are selected", () => {
    const c = { ...config(), imagesEnabled: true };
    expect(novelStepProblem("visuals", c)).toBe("novel.setup.needWorkflow");
    expect(isNovelWorkflow({ nodes: [], links: [] })).toBe(false);
    expect(isNovelWorkflow({ foo: "not a workflow" })).toBe(false);
    const workflow = { "1": { class_type: "CLIPTextEncode", inputs: { text: "" } } };
    expect(firstNovelProblem({ ...c, workflow })).toBeNull();
    expect(firstNovelProblem({ ...c, workflow, comfyUrl: "http://key:secret@localhost" })?.problem).toBe("novel.setup.needComfyUrl");
  });
  it("catches empty numeric fields and out-of-range limits before sending a request", () => {
    expect(firstNovelProblem({ ...config(), maxTokens: NaN })?.problem).toBe("novel.setup.invalidLimits");
    expect(firstNovelProblem({ ...config(), imagesEnabled: true, workflow: { "1": { class_type: "X", inputs: {} } }, width: 12 })?.problem).toBe("novel.setup.invalidDimensions");
  });
});

it('accepts a complete foundation card without extra premise and keeps empty stories invalid',()=>{
 expect(novelStepProblem('story',{...DEFAULT_NOVEL_CONFIG,premise:'',settingCardIds:['source-card']})).toBeNull();
 expect(novelStepProblem('story',{...DEFAULT_NOVEL_CONFIG,premise:'',settingCardIds:[]})).toBe('novel.setup.needPremise');
});
