export const LEGACY_NOVEL_ART_STYLE="hand-painted visual novel, cinematic lighting, detailed scenery, no text";
export const PREVIOUS_NOVEL_ART_STYLE="2D anime visual novel illustration, clean fine lineart, flat cel shading, restrained soft gradients, consistent facial proportions, controlled color palette, detailed illustrated backgrounds";
export const NOVEL_ART_STYLES={
  cinematic:"Premium cinematic game key art, finely drawn stylized characters, crisp controlled contours, sculpted layered shading, delicate material highlights, rich jewel-tone color harmony and finely detailed environmental artwork. Polished 2D illustration with cohesive facial proportions and strong spatial depth.",
  painterly:"Detailed gouache fantasy illustration with textured brushwork, softly blended edges, subtle paper grain, finely modeled faces, rich pigment colors and intricate hand-painted backgrounds. Cohesive illustrated character design with refined material textures.",
  anime:"Polished 2D anime key visual with delicate precise lineart, expressive finely detailed eyes and cohesive character proportions. Refined layered cel shading, subtle ambient occlusion, clean material highlights, rich balanced colors and beautifully detailed backgrounds with clear spatial depth.",
  manga:"Refined black-and-white manga illustration with expressive precise ink linework, detailed crosshatching, layered screentones and crisp high-contrast shapes. Consistent character proportions and richly drawn environmental details, without speech bubbles or lettering."
} as const;
export type NovelArtStylePreset=keyof typeof NOVEL_ART_STYLES;
export const DEFAULT_NOVEL_ART_STYLE=NOVEL_ART_STYLES.cinematic;
export function normalizeNovelArtStyle(value:unknown) {
  const style=typeof value==="string"?value.trim():"";
  return !style || style===LEGACY_NOVEL_ART_STYLE || style===PREVIOUS_NOVEL_ART_STYLE ? DEFAULT_NOVEL_ART_STYLE : style;
}
export function novelArtStylePreset(value:unknown):NovelArtStylePreset|"custom" {
  const style=normalizeNovelArtStyle(value);
  return (Object.keys(NOVEL_ART_STYLES) as NovelArtStylePreset[]).find(key=>NOVEL_ART_STYLES[key]===style) || "custom";
}
