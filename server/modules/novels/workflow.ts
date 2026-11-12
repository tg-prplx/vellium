import { record } from "./normalize.js";
import type { NovelConfig } from "../../../src/shared/types/novels.js";

export function patchNovelWorkflow(workflow: Record<string, unknown>, config: NovelConfig, prompt: string, seed: number) {
  const graph = structuredClone(workflow);
  if (graph.nodes || !Object.keys(graph).length) throw new Error("Import a ComfyUI workflow in API format");
  const entries = Object.entries(graph).map(([id, value]) => [id, record(value)] as const);
  const sampler = entries.find(([, n]) => ["KSampler","KSamplerAdvanced","SamplerCustom","SamplerCustomAdvanced"].includes(String(n.class_type)));
  function findText(id: unknown, seen = new Set<string>()): string | undefined {
    if (typeof id !== "string" && typeof id !== "number") return;
    const key = String(id); if (seen.has(key)) return; seen.add(key);
    const node = record(graph[key]); const inputs = record(node.inputs);
    if (typeof inputs.text === "string") return key;
    for (const value of Object.values(inputs)) if (Array.isArray(value)) { const found = findText(value[0], seen); if (found) return found; }
  }
  const samplerInputs = record(sampler?.[1].inputs);
  const guider=record(record(graph[String(Array.isArray(samplerInputs.guider)?samplerInputs.guider[0]:"")]).inputs);
  const positiveLink=samplerInputs.positive ?? guider.positive ?? guider.conditioning;
  const negativeLink=samplerInputs.negative ?? guider.negative;
  const positive = config.positiveNode || findText(Array.isArray(positiveLink) ? positiveLink[0] : null);
  const negative = config.negativeNode || findText(Array.isArray(negativeLink) ? negativeLink[0] : null);
  if (!positive || typeof record(record(graph[positive]).inputs).text !== "string") throw new Error("Positive text node not found; set its ID");
  if (negative && positive === negative) throw new Error("Positive and negative nodes must be different");
  record(record(graph[positive]).inputs).text = prompt;
  if (negative && config.overrideWorkflowNegative) {
    const input = record(record(graph[negative]).inputs);
    if (typeof input.text !== "string") throw new Error("Negative text node not found");
    input.text = config.negativePrompt;
  }
  const latentIds=new Set<string>();
  function findLatent(id:unknown,seen=new Set<string>()) {
    const key=String(id);if(seen.has(key))return;seen.add(key);
    const node=record(graph[key]);
    if(/^Empty.*Latent/.test(String(node.class_type||""))) {latentIds.add(key);return;}
    for(const link of Object.values(record(node.inputs)))if(Array.isArray(link))findLatent(link[0],seen);
  }
  if(Array.isArray(samplerInputs.latent_image))findLatent(samplerInputs.latent_image[0]);
  if(!latentIds.size) {const first=entries.find(([,n])=>/^Empty.*Latent/.test(String(n.class_type||"")));if(first)latentIds.add(first[0]);}
  const noiseId=Array.isArray(samplerInputs.noise)?String(samplerInputs.noise[0]):"";
  for (const [id, node] of entries) {
    const inputs = record(node.inputs);
    if(id===sampler?.[0]) {if("seed" in inputs)inputs.seed=seed;if("noise_seed" in inputs)inputs.noise_seed=seed;}
    if(id===noiseId && node.class_type==="RandomNoise" && "noise_seed" in inputs)inputs.noise_seed=seed;
    if(latentIds.has(id)) {inputs.width=config.width;inputs.height=config.height;}
  }
  return graph;
}
