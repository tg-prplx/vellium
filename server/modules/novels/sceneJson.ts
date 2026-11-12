/** Recover already-written JSON values locally. Never invent missing prose or
 * execute model output. Repair separators only at recognizable value/property
 * boundaries. An unfinished string is discarded, not completed. */
export function readSceneJson(raw: string): unknown {
  if (raw.length > 500000) throw new Error("Model response exceeds the novel limit");
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(clean); } catch { /* Tolerate wrappers and truncation below. */ }
  const start = clean.search(/[\[{]/);
  if (start < 0) throw new Error("No scene JSON in response");
  let pos = start, nodes = 0;
  const missing = Symbol("unfinished");
  const space = () => { while (/\s/.test(clean[pos] || "") && pos < clean.length) pos++; };
  function string(): string | typeof missing {
    const quote = clean[pos++]; let value = "";
    while (pos < clean.length) {
      const ch = clean[pos++];
      if (ch === quote) return value;
      if (ch !== "\\") { value += ch; continue; }
      if (pos >= clean.length) return missing;
      const escaped = clean[pos++];
      if (escaped === "u") {
        const hex = clean.slice(pos, pos + 4);
        if (!/^[\da-f]{4}$/i.test(hex)) return missing;
        value += String.fromCharCode(parseInt(hex, 16)); pos += 4;
      } else {
        const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", '"': '"', "'": "'", "\\": "\\", "/": "/" };
        if (!(escaped in escapes)) return missing;
        value += escapes[escaped];
      }
    }
    return missing;
  }
  function value(depth: number): unknown | typeof missing {
    if (depth > 64 || ++nodes > 20000) throw new Error("Scene JSON is too deeply nested or complex");
    space(); const ch = clean[pos];
    if (ch === '"' || ch === "'") return string();
    if (ch === "{" || ch === "[") {
      pos++; const array = ch === "[";
      const result: unknown[] | Record<string, unknown> = array ? [] : Object.create(null);
      while (pos < clean.length) {
        space();
        // Repeated/trailing commas carry no story data.
        while(clean[pos]===","){pos++;space();}
        if (clean[pos] === (array ? "]" : "}")) { pos++; return result; }
        let key = "";
        if (!array) {
          if (clean[pos] === '"' || clean[pos] === "'") {
            const read = string(); if (read === missing) return result; key = read;
          } else {
            const match = /^[a-zA-Z_][\w-]*/.exec(clean.slice(pos));
            if (!match) return result;
            key = match[0]; pos += key.length;
          }
          space(); if (clean[pos++] !== ":") return result;
        }
        const read = value(depth + 1);
        if (read === missing) return result;
        if (array) (result as unknown[]).push(read);
        else Object.defineProperty(result, key, { value: read, enumerable: true, configurable: true, writable: true });
        space();
        if (clean[pos] === ",") { pos++; continue; }
        if (clean[pos] === (array ? "]" : "}")) { pos++; return result; }
        // A missing comma must not discard completed later lines, shots or cast.
        // Continue only at an unambiguous next JSON member; never skip arbitrary
        // text or try to execute expressions from the response.
        const tail=clean.slice(pos);
        const nextMember=array
          ? /^(?:[\[\{"']|true\b|false\b|null\b|-?\d)/.test(tail)
          : /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[a-zA-Z_][\w-]*)\s*:/.test(tail);
        if(nextMember)continue;
        return result;
      }
      return result;
    }
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s|[,}\]]|$)/.exec(clean.slice(pos));
    if (!primitive) return missing;
    pos += primitive[0].length; return JSON.parse(primitive[0]);
  }
  const parsed = value(0);
  if (parsed === missing) throw new Error("No recoverable scene JSON");
  return parsed;
}
