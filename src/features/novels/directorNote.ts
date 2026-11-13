import type { TranslationKey } from "../../shared/i18n";

/** "Follow-up: no choice, describe Ren" — why a second request runs. */
export function directorNote(reasons: string[], t: (key: TranslationKey) => string) {
  const parts = reasons.map((reason) => reason === "choice" ? t("novel.directorChoice")
    : reason === "pictures" ? t("novel.directorPictures")
    : reason === "more-pictures" ? t("novel.directorMorePictures")
    : reason.startsWith("describe:") ? t("novel.directorDescribe").replace("{names}", reason.slice(9)) : "").filter(Boolean);
  return parts.length ? `${t("novel.directing")}: ${parts.join(", ")}` : t("novel.directing");
}
