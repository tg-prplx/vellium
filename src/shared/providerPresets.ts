export type ProviderPreset = {
  key: string;
  label: string;
  description: string;
  baseUrl: string;
  defaultId: string;
  defaultName: string;
  apiKeyHint: string;
  localOnly: boolean;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "openai",
    label: "OpenAI",
    description: "Official OpenAI API",
    baseUrl: "https://api.openai.com/v1",
    defaultId: "openai",
    defaultName: "OpenAI",
    apiKeyHint: "sk-...",
    localOnly: false
  },
  {
    key: "lm_studio",
    label: "LM Studio",
    description: "Local OpenAI-compatible server",
    baseUrl: "http://localhost:1234/v1",
    defaultId: "lm-studio",
    defaultName: "LM Studio (Local)",
    apiKeyHint: "any string",
    localOnly: true
  },
  {
    key: "ollama",
    label: "Ollama",
    description: "Ollama OpenAI-compatible endpoint",
    baseUrl: "http://localhost:11434/v1",
    defaultId: "ollama",
    defaultName: "Ollama (Local)",
    apiKeyHint: "ollama",
    localOnly: true
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter unified API",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultId: "openrouter",
    defaultName: "OpenRouter",
    apiKeyHint: "sk-or-v1-...",
    localOnly: false
  },
  {
    key: "custom",
    label: "Custom",
    description: "Any OpenAI-compatible provider",
    baseUrl: "http://localhost:8080/v1",
    defaultId: "custom-provider",
    defaultName: "Custom Provider",
    apiKeyHint: "your key",
    localOnly: false
  }
];
