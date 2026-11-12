import {expect,it} from "vitest";
import {canonicalShot} from "./shotPrompt.js";
it("keeps action and camera while removing competing costume and scenery descriptions",()=>{
 const result=canonicalShot("She wears a green bikini. The background is a tropical beach. She smiles and raises her right hand. Eye-level medium shot.",true,true);
 expect(result).toBe("She smiles and raises her right hand. Eye-level medium shot.");
});
it("does not leak rewritten hair or eye color into the shot",()=>{
 expect(canonicalShot("She has blue eyes and black hair. She waves toward the viewer.",true,true)).toBe("She waves toward the viewer.");
});
it("uses a neutral camera fallback rather than inventing a new costume or place",()=>{
 const result=canonicalShot("Red bikini, pool, white tiles",true,true);expect(result).not.toMatch(/bikini|pool|tiles/);
});
it("rejects shot-level art directions and lighting that compete with the locked style and set",()=>{
 expect(canonicalShot("Watercolor painting with thick brush strokes. Photorealistic 3D render. Golden hour sunlight. She waves toward the viewer. Medium shot.",true,true)).toBe("She waves toward the viewer. Medium shot.");
});
it("preserves a changed action when only a comma-separated lighting suffix conflicts",()=>{
 expect(canonicalShot("She lifts the key and looks toward the viewer, soft light.",true,true)).toBe("She lifts the key and looks toward the viewer");
});
