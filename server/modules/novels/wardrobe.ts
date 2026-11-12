/** Read clothing from legacy English appearance anchors once, rather than
 * leaving the image model to invent a new costume on every frame. */
const garment=/\b(?:bikini|swimsuit|swimwear|one-piece|two-piece|coat|jacket|dress|shirt|blouse|skirt|shorts|trousers|pants|boots|sandals|bra|panties|stockings|gloves|hat|uniform|hoodie|jeans|ribbon|scarf)\b/i;
export function legacyOutfit(appearance:string) {
  const explicit=/\b(?:wearing|dressed in)\s+([^.!?]+)/i.exec(appearance)?.[1];
  if(explicit && garment.test(explicit))return explicit.trim().slice(0,500);
  return appearance.split(/[,;.!?\n]/).map(part=>part.trim()).filter(part=>garment.test(part)).join(", ").slice(0,500);
}
