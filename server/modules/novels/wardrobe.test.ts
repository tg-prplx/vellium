import {expect,it} from "vitest";
import {legacyOutfit,normalizeOutfit,stripClothing} from "./wardrobe.js";
it("recovers exact existing clothing rather than generating a fresh outfit",()=>{
 expect(legacyOutfit('long red hair, green eyes, blue striped bikini, white sandals')).toBe('blue striped bikini, white sandals');
 expect(legacyOutfit('A woman with red hair wearing a navy one-piece swimsuit with white straps.')).toBe('a navy one-piece swimsuit with white straps');
 expect(legacyOutfit('short red hair, green eyes')).toBe('');
});

it("removes clothing from a mixed card description but keeps the person",()=>{
 expect(stripClothing("A young woman with short silver hair and grey eyes. She wears a dark green raincoat over a white sweater, black boots. Slim build.")).toBe("A young woman with short silver hair, grey eyes, Slim build");
 expect(stripClothing("tall man, messy black hair, navy blazer and red necktie, brown eyes")).toBe("tall man, messy black hair, brown eyes");
 expect(stripClothing("long hair tied with a ribbon")).toBe("long hair tied");
 expect(stripClothing("short red hair, green eyes")).toBe("short red hair, green eyes");
});
it("normalises an empty outfit",()=>{
 expect(normalizeOutfit("Nothing")).toBe("no clothing"); expect(normalizeOutfit(" blue swimsuit ")).toBe("blue swimsuit");
});
