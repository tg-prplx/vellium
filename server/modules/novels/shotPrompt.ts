/** Appearance, wardrobe and setting are supplied by canonical anchors. Do not
 * allow a free-form shot to introduce a competing costume or background. */
export function canonicalShot(prompt:string,hasOutfits:boolean,hasSetting:boolean,camera?:"first-person"|"external"|"over-shoulder") {
  // "Camera" is taken literally by anime image models (lenses, vignettes).
  prompt=prompt.replace(/\bthe camera (?:shows|sees|captures|frames|focuses on)\s+/gi,"").replace(/\b(toward|towards|at|into) the camera\b/gi,"$1 the viewer").replace(/\bcamera\b/gi,"view");
  if(camera && camera!=="first-person")prompt=prompt.replace(/\b(?:first[- ]person(?:\s+(?:pov|view|shot|perspective))?|pov(?: shot)?)\b/gi,camera==="external"?"third-person view":"over-the-shoulder view");
  const wardrobe=/\b(?:wearing|dressed|bikini|swimsuit|swimwear|one-piece|two-piece|coat|jacket|dress|shirt|skirt|shorts|trousers|pants|boots|sandals|bra|panties|stockings|gloves|hat|straps|clothing|outfit)\b/i;
  const background=/\b(?:background|setting|location|takes place|pool|beach|forest|bedroom|bathroom|hotel|temple|garden|street|indoors|outdoors|walls?|tiles?|furniture|building|seaside|ocean|lake|cafe|classroom)\b/i;
  const style=/\b(?:photorealistic|photograph|photography|watercolou?r|oil painting|oil on canvas|painterly|brush strokes|brushwork|3d render|cgi|pixel art|charcoal|pencil sketch|digital painting|rendered in|art style|artstyle|masterpiece|best quality|absurdres|highres|score_\d+)\b|@[\w]/i;
  const lighting=/\b(?:lighting|sunlight|moonlight|daylight|sunset|sunrise|golden hour|nighttime|neon|warm glow|morning light|evening light|soft light|harsh light|rim light)\b/i;
  const appearance=/\b(?:hair|eyes?|hairstyle|skin|face|build)\s*(?:color|is|are|:)|\b(?:blonde|brunette|redhead|blue eyes|green eyes|red hair|black hair|white hair)\b/i;
  // Only static descriptions compete with the anchors ("She wears a bikini",
  // "The background is a beach", bare "red bikini, pool"). Actions that involve
  // clothing or the place ("pulls her swimsuit strap down", "sits on the
  // towel") are what the picture is for, so they stay.
  const describesOutfit=/\b(?:wears?|wearing|dressed|clad|attire|outfit)\b/i;
  const changesOutfit=/\b(?:takes?|took|pulls?|pulled|removes?|removed|unbutton\w*|unzip\w*|slips?|slipped|strips?|stripped|puts?|changes?|changed|undress\w*|adjusts?|adjusted|tugs?|tugged|lifts?|lifted|drops?|dropped|untie\w*|ties|tied|opens?|opened)\b/i;
  const describesPlace=/\b(?:background|setting|takes place|is set in|backdrop)\b/i;
  const fragment=(sentence:string)=>!/\b(?:she|he|they|it|i|you|we|her|his|their|its)\b/i.test(sentence) && sentence.includes(",");
  return prompt.split(/(?<=[.!?])\s+|\n+|,\s*(?=(?:soft|harsh|warm|cool|golden|neon|morning|evening|sunset|sunrise|cinematic|dramatic)\b)/i).filter(sentence=>
    !style.test(sentence) && !appearance.test(sentence) && !(hasSetting&&lighting.test(sentence))
    && !(hasOutfits&&wardrobe.test(sentence)&&((describesOutfit.test(sentence)&&!changesOutfit.test(sentence))||fragment(sentence)))
    && !(hasSetting&&background.test(sentence)&&(describesPlace.test(sentence)||fragment(sentence)))
  ).join(" ").trim() || "Eye-level framing of the current action. Preserve the established scene composition.";
}
