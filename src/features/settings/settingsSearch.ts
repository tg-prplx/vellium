import type { TranslationKey } from "../../shared/i18n";
import { en } from "../../shared/locales/en";
import { ja } from "../../shared/locales/ja";
import { ru } from "../../shared/locales/ru";
import { zh } from "../../shared/locales/zh";
import {
  buildSettingsNavigation,
  type SettingsCategory
} from "./config";

export interface SettingsSearchEntry {
  id: string;
  kind: "section" | "setting";
  category: SettingsCategory;
  categoryLabel: string;
  sectionId: string;
  sectionLabel: string;
  label: string;
  targetLabel?: string;
  searchText: string;
}

type SearchDefinition = readonly [
  category: SettingsCategory,
  sectionId: string,
  labelKey: TranslationKey,
  aliases?: string
];

const SEARCH_DEFINITIONS: SearchDefinition[] = [
  ["connection", "settings-quick-presets", "settings.quickPresets", "provider presets quick add провайдеры пресеты"],
  ["connection", "settings-manual-provider", "settings.providerId", "provider id идентификатор"],
  ["connection", "settings-manual-provider", "settings.providerName", "provider name имя провайдера"],
  ["connection", "settings-manual-provider", "settings.baseUrl", "endpoint base url адрес api"],
  ["connection", "settings-manual-provider", "settings.providerType", "openai kobold custom тип провайдера"],
  ["connection", "settings-manual-provider", "settings.adapterId", "adapter адаптер"],
  ["connection", "settings-manual-provider", "settings.apiKey", "api key ключ токен"],
  ["connection", "settings-manual-provider", "settings.proxyUrl", "proxy прокси"],
  ["connection", "settings-manual-provider", "settings.providerManualFallback", "manual models модели вручную"],
  ["connection", "settings-manual-provider", "settings.localOnly", "local only локальный"],
  ["connection", "settings-runtime-mode", "settings.fullLocalMode", "offline local mode локальный режим"],
  ["connection", "settings-active-model", "settings.activeModel", "chat model active model модель чата"],
  ["connection", "settings-translation-model", "settings.translateModel", "translation model перевод модель"],
  ["connection", "settings-compress-model", "settings.compressModel", "compression model summary сжатие модель"],
  ["connection", "settings-tts", "settings.ttsRealtime", "tts realtime streaming потоковая озвучка"],
  ["connection", "settings-tts", "settings.ttsEndpoint", "tts url endpoint адрес"],
  ["connection", "settings-tts", "settings.apiKey", "tts api key ключ озвучки"],
  ["connection", "settings-tts", "settings.ttsAdapterId", "tts adapter адаптер"],
  ["connection", "settings-tts", "settings.ttsModel", "tts model модель озвучки"],
  ["connection", "settings-tts", "settings.ttsVoice", "tts voice голос"],
  ["connection", "settings-stt", "settings.sttSource", "stt whisper source распознавание источник"],
  ["connection", "settings-stt", "settings.sttEndpoint", "stt whisper endpoint url адрес"],
  ["connection", "settings-stt", "settings.apiKey", "stt whisper api key ключ распознавания"],
  ["connection", "settings-stt", "settings.sttModel", "stt whisper model модель"],
  ["connection", "settings-stt", "settings.sttLanguage", "stt language язык распознавания"],
  ["connection", "settings-local-speech", "localModels.speechTitle", "local speech whisper piper ohf локальная речь"],
  ["backends", "settings-managed-backends", "settings.managedBackends", "llama cpp backend local server бекенд"],
  ["interface", "settings-general", "settings.theme", "theme dark light тема"],
  ["interface", "settings-general", "settings.pluginTheme", "plugin theme тема плагина"],
  ["interface", "settings-wallpaper", "settings.wallpaperActive", "wallpaper background обои фон"],
  ["interface", "settings-wallpaper", "settings.wallpaperDim", "wallpaper dim затемнение обоев"],
  ["interface", "settings-wallpaper", "settings.wallpaperBlur", "wallpaper blur размытие обоев"],
  ["interface", "settings-wallpaper", "settings.wallpaperPosition", "wallpaper position позиция обоев"],
  ["interface", "settings-general", "settings.textSize", "font scale text size размер текста шрифт"],
  ["interface", "settings-general", "settings.interfaceLanguage", "language locale язык интерфейса"],
  ["interface", "settings-welcome-tour", "settings.welcomeTour", "onboarding welcome tour обучение"],
  ["interface", "settings-workspace-mode", "settings.workspaceMode", "simple mode workspace режим интерфейса"],
  ["generation", "settings-output-behaviour", "settings.responseLanguage", "response language язык ответа"],
  ["generation", "settings-output-behaviour", "settings.translateLanguage", "translation language язык перевода"],
  ["generation", "settings-output-behaviour", "settings.censorship", "filtered unfiltered censorship цензура"],
  ["generation", "settings-runtime-tuning", "settings.translationTimeout", "translation timeout таймаут перевода"],
  ["generation", "settings-runtime-tuning", "settings.translationMaxTokens", "translation tokens токены перевода"],
  ["generation", "settings-runtime-tuning", "settings.translationTemperature", "translation temperature температура перевода"],
  ["generation", "settings-runtime-tuning", "settings.autoConversationTurns", "auto conversation turns авто диалог ходы"],
  ["generation", "settings-runtime-tuning", "settings.autoConversationDelay", "auto conversation delay задержка авто диалога"],
  ["generation", "settings-sampler-defaults", "inspector.temperature", "temperature sampler температура"],
  ["generation", "settings-sampler-defaults", "inspector.topP", "top p sampler"],
  ["generation", "settings-sampler-defaults", "inspector.freqPenalty", "frequency penalty штраф частоты"],
  ["generation", "settings-sampler-defaults", "inspector.presPenalty", "presence penalty штраф присутствия"],
  ["generation", "settings-sampler-defaults", "inspector.maxTokens", "max output tokens длина ответа"],
  ["generation", "settings-sampler-defaults", "settings.stopSequences", "stop sequences стоп последовательности"],
  ["generation", "settings-sampler-defaults", "settings.koboldSampler", "top k top a min p typical tfs n sigma repetition penalty kobold семплер"],
  ["generation", "settings-sampler-defaults", "settings.koboldMemoryLabel", "kobold memory память"],
  ["generation", "settings-sampler-defaults", "settings.koboldPhraseBansLabel", "banned phrases запрет фраз"],
  ["generation", "settings-sampler-defaults", "settings.koboldUseDefaultBadwordsIds", "kobold default badwords"],
  ["generation", "settings-api-param-forwarding", "settings.apiParamForwarding", "api params forwarding параметры api"],
  ["generation", "settings-api-param-forwarding", "settings.sendSampler", "send sampler fields пересылать семплеры"],
  ["generation", "settings-api-param-forwarding", "settings.koboldRepetitionPenalty", "kobold repetition penalty"],
  ["generation", "settings-api-param-forwarding", "settings.koboldRepetitionPenaltyRange", "kobold repetition range"],
  ["generation", "settings-api-param-forwarding", "settings.koboldRepetitionPenaltySlope", "kobold repetition slope"],
  ["generation", "settings-api-param-forwarding", "settings.koboldSamplerOrder", "kobold sampler order"],
  ["context", "settings-context-window", "settings.contextSize", "context window size размер контекста"],
  ["context", "settings-context-window", "settings.contextTailWithSummary", "context tail summary хвост с саммари"],
  ["context", "settings-context-window", "settings.contextTailWithoutSummary", "context tail without summary хвост"],
  ["context", "settings-context-window", "settings.strictGrounding", "strict grounding точность контекста"],
  ["context", "settings-chat-behaviour", "settings.altGreetingsRandom", "alternate greetings random приветствия"],
  ["context", "settings-chat-behaviour", "settings.mergeRoles", "merge consecutive roles объединение ролей"],
  ["context", "settings-chat-behaviour", "settings.includeReasoningInContext", "reasoning context thinking ризонинг контекст"],
  ["context", "settings-context-tuning", "settings.contextMaxMessages", "max context messages сообщений в контексте"],
  ["context", "settings-context-tuning", "settings.reasoningMaxChars", "reasoning max chars лимит ризонинга"],
  ["context", "settings-context-tuning", "settings.compressionFallbackMessages", "compression fallback messages сжатие"],
  ["context", "settings-context-tuning", "settings.compressionMaxTokens", "compression max tokens сжатие токены"],
  ["context", "settings-context-tuning", "settings.compressionTemperature", "compression temperature температура сжатия"],
  ["context", "settings-scene-fields", "inspector.dialogueStyle", "scene dialogue style стиль диалога"],
  ["context", "settings-scene-fields", "inspector.initiative", "scene initiative инициативность"],
  ["context", "settings-scene-fields", "inspector.descriptiveness", "scene descriptiveness описательность"],
  ["context", "settings-scene-fields", "inspector.unpredictability", "scene unpredictability непредсказуемость"],
  ["context", "settings-scene-fields", "inspector.emotionalDepth", "scene emotional depth эмоциональная глубина"],
  ["context", "settings-rag-model", "settings.ragModel", "rag embedding model модель"],
  ["context", "settings-rag-model", "settings.ragEnableByDefault", "rag default по умолчанию"],
  ["context", "settings-rag-reranker", "settings.ragRerankerEnable", "rag reranker включить"],
  ["context", "settings-rag-reranker", "settings.ragRerankTopN", "rag rerank top n"],
  ["context", "settings-rag-retrieval", "settings.ragTopK", "rag top k retrieval поиск"],
  ["context", "settings-rag-retrieval", "settings.ragCandidateCount", "rag candidates кандидаты"],
  ["context", "settings-rag-retrieval", "settings.ragSimilarityThreshold", "rag similarity threshold порог"],
  ["context", "settings-rag-retrieval", "settings.ragMaxContextTokens", "rag context tokens токены"],
  ["context", "settings-rag-retrieval", "settings.ragChunkSize", "rag chunk size размер чанка"],
  ["context", "settings-rag-retrieval", "settings.ragChunkOverlap", "rag chunk overlap перекрытие"],
  ["prompts", "settings-prompt-templates", "prompt.jailbreak", "jailbreak prompt промпт"],
  ["prompts", "settings-prompt-templates", "prompt.compress", "compression prompt промпт сжатия"],
  ["prompts", "settings-prompt-templates", "prompt.creativeWriting", "creative writing prompt писательство"],
  ["prompts", "settings-prompt-templates", "prompt.writerGenerate", "writer generate prompt генерация текста"],
  ["prompts", "settings-prompt-templates", "prompt.writerExpand", "writer expand prompt расширение текста"],
  ["prompts", "settings-prompt-templates", "prompt.writerRewrite", "writer rewrite prompt переписать текст"],
  ["prompts", "settings-prompt-templates", "prompt.writerSummarize", "writer summarize prompt саммари текста"],
  ["prompts", "settings-prompt-stack", "inspector.promptStack", "prompt stack блоки промпта"],
  ["prompts", "settings-default-system-prompts", "settings.defaultSysPrompt", "system prompt default системный промпт"],
  ["tools", "settings-tools-core", "settings.toolCallingEnabled", "tools function calling инструменты"],
  ["tools", "settings-tools-core", "settings.toolCallingPolicy", "tool policy политика инструментов"],
  ["tools", "settings-tools-core", "settings.maxToolCalls", "max tool calls лимит инструментов"],
  ["tools", "settings-tools-core", "settings.mcpAutoAttachTools", "mcp auto attach автоматическое подключение"],
  ["tools", "settings-security", "settings.securitySanitizeMarkdown", "sanitize markdown безопасность"],
  ["tools", "settings-security", "settings.securityAllowExternalLinks", "external links ссылки"],
  ["tools", "settings-security", "settings.securityAllowRemoteImages", "remote images изображения"],
  ["tools", "settings-security", "settings.securityAllowUnsafeUploads", "unsafe uploads файлы"],
  ["tools", "settings-plugins", "settings.plugins", "plugins плагины"],
  ["tools", "settings-plugins", "settings.pluginDevAutoRefresh", "plugin auto refresh dev"],
  ["tools", "settings-tools-mcp-functions", "settings.mcpFunctions", "mcp functions функции"],
  ["tools", "settings-tools-mcp", "settings.mcpServers", "mcp servers серверы"],
  ["tools", "settings-tools-mcp", "settings.mcpImportSource", "mcp import json импорт"],
  ["tools", "settings-tools-mcp", "settings.mcpId", "mcp server id идентификатор"],
  ["tools", "settings-tools-mcp", "settings.mcpName", "mcp server name имя"],
  ["tools", "settings-tools-mcp", "settings.mcpCommand", "mcp command команда"],
  ["tools", "settings-tools-mcp", "settings.mcpArgs", "mcp arguments args аргументы"],
  ["tools", "settings-tools-mcp", "settings.mcpTimeout", "mcp timeout таймаут"],
  ["tools", "settings-tools-mcp", "settings.mcpEnabled", "mcp enabled включен"],
  ["tools", "settings-tools-mcp", "settings.mcpEnv", "mcp environment env переменные"],
  ["tools", "settings-danger-zone", "settings.resetAll", "reset settings сбросить всё"],
  ["legacy", "settings-legacy", "legacy.overview", "legacy agents deprecated легаси агенты"]
];

const SEARCH_DICTIONARIES = [en, ru, zh, ja] as Array<Record<string, string>>;

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function translatedAliases(key: TranslationKey): string {
  return SEARCH_DICTIONARIES
    .map((dictionary) => dictionary[key])
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function buildSettingsSearchEntries(t: (key: TranslationKey) => string): SettingsSearchEntry[] {
  const { categoryNav, categorySections } = buildSettingsNavigation(t);
  const categoryLabels = new Map(categoryNav.map((category) => [category.id, category.label]));
  const sectionLabels = new Map<string, string>();
  const sections: SettingsSearchEntry[] = [];

  for (const category of categoryNav) {
    for (const section of categorySections[category.id]) {
      sectionLabels.set(section.id, section.label);
      sections.push({
        id: `section:${section.id}`,
        kind: "section",
        category: category.id,
        categoryLabel: category.label,
        sectionId: section.id,
        sectionLabel: section.label,
        label: section.label,
        searchText: normalized(`${category.label} ${section.label} ${section.id}`)
      });
    }
  }

  const settings = SEARCH_DEFINITIONS.map(([category, sectionId, labelKey, aliases = ""]) => {
    const label = t(labelKey);
    const categoryLabel = categoryLabels.get(category) || category;
    const sectionLabel = sectionLabels.get(sectionId) || label;
    return {
      id: `setting:${sectionId}:${labelKey}`,
      kind: "setting" as const,
      category,
      categoryLabel,
      sectionId,
      sectionLabel,
      label,
      targetLabel: label,
      searchText: normalized([
        label,
        translatedAliases(labelKey),
        categoryLabel,
        sectionLabel,
        labelKey,
        aliases
      ].join(" "))
    };
  });

  return [...sections, ...settings];
}

export function searchSettingsEntries(
  entries: SettingsSearchEntry[],
  query: string,
  limit = 18
): SettingsSearchEntry[] {
  const normalizedQuery = normalized(query);
  if (!normalizedQuery) {
    return entries.filter((entry) => entry.kind === "section").slice(0, limit);
  }
  const tokens = normalizedQuery.split(" ").filter(Boolean);

  return entries
    .map((entry) => {
      if (!tokens.every((token) => entry.searchText.includes(token))) return null;
      const label = normalized(entry.label);
      const section = normalized(entry.sectionLabel);
      let score = entry.kind === "setting" ? 20 : 0;
      if (label === normalizedQuery) score += 180;
      else if (label.startsWith(normalizedQuery)) score += 120;
      else if (label.includes(normalizedQuery)) score += 80;
      if (section.startsWith(normalizedQuery)) score += 35;
      score -= Math.min(label.length, 80) / 100;
      return { entry, score };
    })
    .filter((item): item is { entry: SettingsSearchEntry; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .slice(0, limit)
    .map((item) => item.entry);
}
