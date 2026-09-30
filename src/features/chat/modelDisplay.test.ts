import { expect, it } from "vitest";
import { modelDisplayName } from "./modelDisplay";

it("shows the filename of local models without changing routed provider IDs", () => {
  expect(modelDisplayName("C:\\Users\\User\\Models\\Gemma.Q4_K_M.gguf")).toBe("Gemma.Q4_K_M.gguf");
  expect(modelDisplayName("/Users/user/models/Gemma.gguf")).toBe("Gemma.gguf");
  expect(modelDisplayName("openai/gpt-4.1")).toBe("openai/gpt-4.1");
  expect(modelDisplayName(" My custom model ")).toBe("My custom model");
  expect(modelDisplayName("")).toBe("");
});
