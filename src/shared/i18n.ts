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

function createI18nValue(locale: Locale) {
  return {
    locale,
    t(key: TranslationKey): string {
      return completedTranslations[locale][key] ?? en[key] ?? key;
    }
  };
}

const i18nValues: Record<Locale, ReturnType<typeof createI18nValue>> = {
  en: createI18nValue("en"),
  ru: createI18nValue("ru"),
  zh: createI18nValue("zh"),
  ja: createI18nValue("ja")
};

export function getI18n(locale: Locale) {
  return i18nValues[locale];
}

export function useI18n() {
  const locale = useContext(I18nContext);
  return getI18n(locale);
}
