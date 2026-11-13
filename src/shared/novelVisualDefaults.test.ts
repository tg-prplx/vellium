import {expect,it} from "vitest";
import {DEFAULT_NOVEL_ART_STYLE,LEGACY_NOVEL_ART_STYLE,PREVIOUS_NOVEL_ART_STYLE,normalizeNovelArtStyle} from "./novelVisualDefaults";
it("upgrades only the known vague factory style and preserves customized styles",()=>{
 expect(normalizeNovelArtStyle(LEGACY_NOVEL_ART_STYLE)).toBe(DEFAULT_NOVEL_ART_STYLE);expect(normalizeNovelArtStyle(undefined)).toBe(DEFAULT_NOVEL_ART_STYLE);
 expect(normalizeNovelArtStyle(PREVIOUS_NOVEL_ART_STYLE)).toBe(DEFAULT_NOVEL_ART_STYLE);
 for(const custom of ['watercolor, soft outlines','hand-painted visual novel, my custom palette','ink illustration'])expect(normalizeNovelArtStyle(custom)).toBe(custom);
});

it("recognizes each selectable preset without silently converting it to another style",async()=>{
 const {NOVEL_ART_STYLES,novelArtStylePreset}=await import('./novelVisualDefaults');
 for(const [id,prompt] of Object.entries(NOVEL_ART_STYLES)){expect(normalizeNovelArtStyle(prompt)).toBe(prompt);expect(novelArtStylePreset(prompt)).toBe(id);}
 expect(novelArtStylePreset('my custom illustration style')).toBe('custom');
});

it("moves an untouched prose preset to the tag-led preset of the same name",async()=>{
 const {NOVEL_ART_STYLES,novelArtStylePreset}=await import('./novelVisualDefaults');
 const oldManga="Refined black-and-white manga illustration with expressive precise ink linework, detailed crosshatching, layered screentones and crisp high-contrast shapes. Consistent character proportions and richly drawn environmental details, without speech bubbles or lettering.";
 expect(normalizeNovelArtStyle(oldManga)).toBe(NOVEL_ART_STYLES.manga);expect(novelArtStylePreset(oldManga)).toBe('manga');
 expect(normalizeNovelArtStyle(oldManga+" My edit.")).toBe(oldManga+" My edit.");
 for(const key of ['constructor','toString','__proto__'])expect(normalizeNovelArtStyle(key)).toBe(key);
});
