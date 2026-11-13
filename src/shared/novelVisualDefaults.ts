export const LEGACY_NOVEL_ART_STYLE="hand-painted visual novel, cinematic lighting, detailed scenery, no text";
export const PREVIOUS_NOVEL_ART_STYLE="2D anime visual novel illustration, clean fine lineart, flat cel shading, restrained soft gradients, consistent facial proportions, controlled color palette, detailed illustrated backgrounds";
/** Tag-led styles: anime image models (Anima, Illustrious-family) render flat
 * and neutral without quality tags, so each preset opens with them and ends in
 * one sentence. No safety tag: it must not fight the story's content rating. */
export const NOVEL_ART_STYLES={
  anime:"masterpiece, best quality, score_7, newest, anime coloring, clean lineart, cel shading, vibrant colors, detailed eyes, detailed background. A polished anime key visual with clear depth.",
  screencap:"masterpiece, best quality, score_7, newest, anime screencap, flat color, clean lineart, soft ambient lighting, detailed background. A frame from a modern TV anime with natural staging.",
  cinematic:"masterpiece, best quality, score_7, newest, game cg, soft shading, cinematic lighting, depth of field, detailed background. A visual novel event illustration with rich atmosphere.",
  semireal:"masterpiece, best quality, score_7, newest, realistic shading, detailed skin, volumetric lighting, depth of field, detailed background. A semi-realistic digital painting with anime facial proportions.",
  painterly:"masterpiece, best quality, score_7, painterly, soft brushwork, watercolor (medium), muted colors, detailed background. A hand-painted storybook illustration.",
  pastel:"masterpiece, best quality, score_7, newest, pastel colors, soft lighting, bloom, light particles, delicate lineart, detailed background. A gentle, airy illustration with a dreamy mood.",
  dark:"masterpiece, best quality, score_7, newest, dark, dramatic lighting, chiaroscuro, high contrast, muted colors, heavy shadows, detailed background. A moody dark fantasy illustration.",
  retro:"masterpiece, best quality, score_7, retro artstyle, 1990s (style), anime screencap, cel animation, film grain, muted colors. A frame from a hand-drawn 1990s anime.",
  flat:"masterpiece, best quality, score_7, newest, flat color, bold outlines, limited palette, simple shading, minimalist background. A clean graphic illustration with strong shapes.",
  sketch:"masterpiece, best quality, score_7, sketch, graphite (medium), traditional media, rough lineart, limited palette. An expressive pencil drawing with light colour washes.",
  manga:"masterpiece, best quality, score_7, monochrome, greyscale, screentones, hatching (texture), clean ink lineart. A black-and-white manga illustration without speech bubbles or text.",
  pixel:"masterpiece, best quality, score_7, pixel art, limited palette, dithering, crisp pixels, detailed background. A retro adventure game scene."
} as const;
export type NovelArtStylePreset=keyof typeof NOVEL_ART_STYLES;
export const DEFAULT_NOVEL_ART_STYLE=NOVEL_ART_STYLES.anime;
/** Prose-only presets shipped before tag-led styles. A story still holding one
 * of these exact strings moves to the preset of the same name; edited styles stay. */
const PROSE_NOVEL_ART_STYLES:Record<string,NovelArtStylePreset>={
  ["Premium cinematic game key art, finely drawn stylized characters, crisp controlled contours, sculpted layered shading, delicate material highlights, rich jewel-tone color harmony and finely detailed environmental artwork. Polished 2D illustration with cohesive facial proportions and strong spatial depth."]:"cinematic",
  ["Detailed gouache fantasy illustration with textured brushwork, softly blended edges, subtle paper grain, finely modeled faces, rich pigment colors and intricate hand-painted backgrounds. Cohesive illustrated character design with refined material textures."]:"painterly",
  ["Polished 2D anime key visual with delicate precise lineart, expressive finely detailed eyes and cohesive character proportions. Refined layered cel shading, subtle ambient occlusion, clean material highlights, rich balanced colors and beautifully detailed backgrounds with clear spatial depth."]:"anime",
  ["Refined black-and-white manga illustration with expressive precise ink linework, detailed crosshatching, layered screentones and crisp high-contrast shapes. Consistent character proportions and richly drawn environmental details, without speech bubbles or lettering."]:"manga"
};
export const PREVIOUS_NOVEL_NEGATIVE_PROMPT="text, watermark, bad anatomy, low quality";
export const DEFAULT_NOVEL_NEGATIVE_PROMPT="worst quality, low quality, score_1, score_2, score_3, artist name, text, watermark";
export function normalizeNovelArtStyle(value:unknown) {
  const style=typeof value==="string"?value.trim():"";
  if(!style || style===LEGACY_NOVEL_ART_STYLE || style===PREVIOUS_NOVEL_ART_STYLE)return DEFAULT_NOVEL_ART_STYLE;
  const preset=Object.prototype.hasOwnProperty.call(PROSE_NOVEL_ART_STYLES,style)?PROSE_NOVEL_ART_STYLES[style]:undefined;
  return preset?NOVEL_ART_STYLES[preset]:style;
}
export function novelArtStylePreset(value:unknown):NovelArtStylePreset|"custom" {
  const style=normalizeNovelArtStyle(value);
  return (Object.keys(NOVEL_ART_STYLES) as NovelArtStylePreset[]).find(key=>NOVEL_ART_STYLES[key]===style) || "custom";
}
