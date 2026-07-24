import type { TranslationKey } from "./i18n";

export type SceneLevelAxis =
  | "intensity"
  | "initiative"
  | "descriptiveness"
  | "unpredictability"
  | "emotionalDepth";

const MODEL_LEVELS: Record<SceneLevelAxis, readonly [string, string, string, string, string]> = {
  intensity: ["minimal", "low", "moderate", "high", "extreme"],
  initiative: ["passive", "reserved", "balanced", "proactive", "leading"],
  descriptiveness: ["sparse", "concise", "balanced", "detailed", "richly detailed"],
  unpredictability: ["predictable", "steady", "varied", "surprising", "chaotic"],
  emotionalDepth: ["restrained", "subtle", "balanced", "deep", "intense"]
};

const UI_LEVEL_KEYS: Record<SceneLevelAxis, readonly [
  TranslationKey,
  TranslationKey,
  TranslationKey,
  TranslationKey,
  TranslationKey
]> = {
  intensity: [
    "inspector.levelIntensityMinimal",
    "inspector.levelIntensityLow",
    "inspector.levelIntensityModerate",
    "inspector.levelIntensityHigh",
    "inspector.levelIntensityExtreme"
  ],
  initiative: [
    "inspector.levelInitiativePassive",
    "inspector.levelInitiativeReserved",
    "inspector.levelInitiativeBalanced",
    "inspector.levelInitiativeProactive",
    "inspector.levelInitiativeLeading"
  ],
  descriptiveness: [
    "inspector.levelDescriptivenessSparse",
    "inspector.levelDescriptivenessConcise",
    "inspector.levelDescriptivenessBalanced",
    "inspector.levelDescriptivenessDetailed",
    "inspector.levelDescriptivenessRich"
  ],
  unpredictability: [
    "inspector.levelUnpredictabilityPredictable",
    "inspector.levelUnpredictabilitySteady",
    "inspector.levelUnpredictabilityVaried",
    "inspector.levelUnpredictabilitySurprising",
    "inspector.levelUnpredictabilityChaotic"
  ],
  emotionalDepth: [
    "inspector.levelEmotionalDepthRestrained",
    "inspector.levelEmotionalDepthSubtle",
    "inspector.levelEmotionalDepthBalanced",
    "inspector.levelEmotionalDepthDeep",
    "inspector.levelEmotionalDepthIntense"
  ]
};

export function getSceneLevelIndex(percent: number): 0 | 1 | 2 | 3 | 4 {
  const normalized = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  if (normalized <= 20) return 0;
  if (normalized <= 40) return 1;
  if (normalized <= 60) return 2;
  if (normalized <= 80) return 3;
  return 4;
}

export function describeSceneLevel(axis: SceneLevelAxis, percent: number): string {
  return MODEL_LEVELS[axis][getSceneLevelIndex(percent)];
}

export function getSceneLevelTranslationKey(axis: SceneLevelAxis, percent: number): TranslationKey {
  return UI_LEVEL_KEYS[axis][getSceneLevelIndex(percent)];
}
