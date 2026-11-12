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
