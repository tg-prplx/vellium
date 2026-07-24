import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { SettingsCategory } from "../config";
import { revealSettingsSearchTarget } from "../utils";

const SETTINGS_CATEGORIES = new Set<SettingsCategory>([
  "connection",
  "backends",
  "interface",
  "generation",
  "context",
  "prompts",
  "tools",
  "legacy"
]);

interface InitialSettingsNavigationOptions {
  ready: boolean;
  activeCategory: SettingsCategory;
  setActiveCategory: Dispatch<SetStateAction<SettingsCategory>>;
  initialCategory?: string;
  initialSectionId?: string;
  initialTargetLabel?: string;
  onHandled?: () => void;
}

export function useInitialSettingsNavigation({
  ready,
  activeCategory,
  setActiveCategory,
  initialCategory,
  initialSectionId,
  initialTargetLabel,
  onHandled
}: InitialSettingsNavigationOptions) {
  useEffect(() => {
    if (!ready) return;
    const nextCategory = SETTINGS_CATEGORIES.has(initialCategory as SettingsCategory)
      ? initialCategory as SettingsCategory
      : null;
    if (!nextCategory && !initialSectionId) return;
    if (nextCategory && activeCategory !== nextCategory) {
      setActiveCategory(nextCategory);
      return;
    }

    let timer: number | null = null;
    let attempts = 0;
    const reveal = () => {
      if (!initialSectionId || revealSettingsSearchTarget(initialSectionId, initialTargetLabel)) {
        onHandled?.();
        return;
      }
      attempts += 1;
      if (attempts >= 6) {
        onHandled?.();
        return;
      }
      timer = window.setTimeout(reveal, 60);
    };
    const frame = window.requestAnimationFrame(reveal);
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    activeCategory,
    initialCategory,
    initialSectionId,
    initialTargetLabel,
    onHandled,
    ready,
    setActiveCategory
  ]);
}
