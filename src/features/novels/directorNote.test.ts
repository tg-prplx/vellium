import { expect, it } from "vitest";
import { directorNote } from "./directorNote";

it("explains why the follow-up request runs", () => {
  const t = (key: string) => ({ "novel.directing": "Follow-up", "novel.directorChoice": "no choice", "novel.directorPictures": "no [pic] lines", "novel.directorDescribe": "describe {names}" } as Record<string, string>)[key] || key;
  expect(directorNote(["choice", "describe:Ren, Kai"], t)).toBe("Follow-up: no choice, describe Ren, Kai");
  expect(directorNote([], t)).toBe("Follow-up");
});
