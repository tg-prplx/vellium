import { createContext, useContext } from "react";
import { en } from "./locales/en";
import { ja } from "./locales/ja";
import { ru } from "./locales/ru";
import { zh } from "./locales/zh";

export type Locale = "en" | "ru" | "zh" | "ja";

export const translations = { en, ru, zh, ja } as const;

export type TranslationKey = keyof typeof en;
type TranslationDict = Record<TranslationKey, string>;

const completedTranslations: Record<Locale, TranslationDict> = {
  en: en as TranslationDict,
  ru: ru as TranslationDict,
  zh: { ...en, ...zh } as TranslationDict,
  ja: { ...en, ...ja } as TranslationDict
};

export const I18nContext = createContext<Locale>("en");

export function useI18n() {
  const locale = useContext(I18nContext);

  function t(key: TranslationKey): string {
    return completedTranslations[locale][key] ?? en[key] ?? key;
  }

  return { t, locale };
}
