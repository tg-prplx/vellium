/** Clothing vocabulary shared by every wardrobe rule. Single words that are
 * often not clothing ("top", "tie") only count in clothing phrases. */
export const GARMENT = /\b(?:bikini|swimsuit|swimwear|one-piece|two-piece|coat|raincoat|overcoat|jacket|blazer|parka|dress|gown|shirt|t-shirt|blouse|tank top|crop top|camisole|sweater|jumper|cardigan|hoodie|vest|skirt|shorts|trousers|pants|jeans|leggings|tights|stockings|socks|boots|shoes|sneakers|heels|sandals|slippers|bra|panties|underwear|lingerie|bodysuit|leotard|uniform|kimono|yukata|robe|bathrobe|apron|necktie|ribbon|scarf|gloves|hat|cap|beret|cloak|cape|armou?r|corset|overalls|tuxedo|suit|choker)\b/i;
const garment = GARMENT;
/** Read clothing from legacy English appearance anchors once, rather than
 * leaving the image model to invent a new costume on every frame. */
export function legacyOutfit(appearance:string) {
  const explicit=/\b(?:wearing|dressed in)\s+([^.!?]+)/i.exec(appearance)?.[1];
  if(explicit && garment.test(explicit))return explicit.trim().slice(0,500);
  return appearance.split(/[,;.!?\n]/).map(part=>part.trim()).filter(part=>garment.test(part)).join(", ").slice(0,500);
}
/** Appearance without clothing. Card descriptions often mix both; when the
 * current outfit is stated separately, old clothing here would be drawn on
 * top of it. Works per clause, so hair, face and build survive. */
export function stripClothing(appearance: string) {
  return appearance
    .replace(/\b(?:wearing|dressed in|clad in)\b[^.!?;]*/gi, "")
    .split(/(?<=[.!?;])\s+|\n+|,\s*|\s+(?:and|with)\s+(?=(?:an?\s+|the\s+|her\s+|his\s+|their\s+)?[\w-]+(?:\s+[\w-]+){0,3}\s*(?:[,.;]|$))/i)
    .map((part) => part.trim().replace(/[.;]+$/, ""))
    .filter((part) => part && !garment.test(part))
    .join(", ");
}
/** A model writes "none" or "naked" when nothing is worn. */
export function normalizeOutfit(value: string) {
  return /^(?:none|nothing|no clothes|naked|nude|unclothed)\.?$/i.test(value.trim()) ? "no clothing" : value.trim();
}
