/** Appearance, wardrobe and setting are supplied by canonical anchors. Do not
 * allow a free-form shot to introduce a competing costume or background. */
export function canonicalShot(prompt:string,hasOutfits:boolean,hasSetting:boolean) {
  const wardrobe=/\b(?:wearing|dressed|bikini|swimsuit|swimwear|one-piece|two-piece|coat|jacket|dress|shirt|skirt|shorts|trousers|pants|boots|sandals|bra|panties|stockings|gloves|hat|straps|clothing|outfit)\b/i;
  const background=/\b(?:background|setting|location|takes place|pool|beach|forest|bedroom|bathroom|hotel|temple|garden|street|indoors|outdoors|walls?|tiles?|furniture|building|seaside|ocean|lake|cafe|classroom)\b/i;
  const style=/\b(?:photorealistic|photograph|photography|watercolou?r|oil painting|oil on canvas|painterly|brush strokes|brushwork|3d render|cgi|pixel art|charcoal|pencil sketch|digital painting|rendered in|art style|artstyle|masterpiece|best quality|absurdres|highres|score_\d+)\b|@[\w]/i;
  const lighting=/\b(?:lighting|sunlight|moonlight|daylight|sunset|sunrise|golden hour|nighttime|neon|warm glow|soft light|harsh light|rim light)\b/i;
  const appearance=/\b(?:hair|eyes?|hairstyle|skin|face|build)\s*(?:color|is|are|:)|\b(?:blonde|brunette|redhead|blue eyes|green eyes|red hair|black hair|white hair)\b/i;
  return prompt.split(/(?<=[.!?])\s+|\n+/).filter(sentence=>
    !style.test(sentence) && !appearance.test(sentence) && !(hasSetting&&lighting.test(sentence)) && !(hasOutfits&&wardrobe.test(sentence)) && !(hasSetting&&background.test(sentence))
  ).join(" ").trim() || "Eye-level framing of the current action. Preserve the established scene composition.";
}
