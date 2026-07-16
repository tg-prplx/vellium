import { describe, expect, it } from "vitest";
import { getI18n } from "./i18n";

describe("i18n value stability", () => {
  it("keeps the translator identity stable until the locale changes", () => {
    const firstRussianValue = getI18n("ru");
    const secondRussianValue = getI18n("ru");

    expect(secondRussianValue).toBe(firstRussianValue);
    expect(secondRussianValue.t).toBe(firstRussianValue.t);
    expect(getI18n("en").t).not.toBe(firstRussianValue.t);
  });
});
