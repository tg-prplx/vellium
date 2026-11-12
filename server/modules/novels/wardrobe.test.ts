import {expect,it} from "vitest";
import {legacyOutfit} from "./wardrobe.js";
it("recovers exact existing clothing rather than generating a fresh outfit",()=>{
 expect(legacyOutfit('long red hair, green eyes, blue striped bikini, white sandals')).toBe('blue striped bikini, white sandals');
 expect(legacyOutfit('A woman with red hair wearing a navy one-piece swimsuit with white straps.')).toBe('a navy one-piece swimsuit with white straps');
 expect(legacyOutfit('short red hair, green eyes')).toBe('');
});
