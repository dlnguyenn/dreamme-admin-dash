import { describe, expect, it } from "vitest";
import { escapeControlCharsInStrings, firstJson } from "@/lib/anthropic";

describe("firstJson", () => {
  it("parses a draft that contains raw line breaks inside the string", () => {
    const raw = `{
  "is_spam": false,
  "summary": "Linda unsure if subscription went through",
  "drafts": [
    "Hi Linda! There's no active subscription on our side.

Thanks so much!
Dan, co-founder of DreamMe",
    "Hi Linda!\tShort one."
  ]
}`;
    expect(() => JSON.parse(raw)).toThrow(/control character/i);
    const parsed = firstJson(raw) as { drafts: string[] };
    expect(parsed.drafts[0]).toBe(
      "Hi Linda! There's no active subscription on our side.\n\nThanks so much!\nDan, co-founder of DreamMe",
    );
    expect(parsed.drafts[1]).toBe("Hi Linda!\tShort one.");
  });

  it("repairs control chars inside a fenced block with surrounding prose", () => {
    const text = 'Here you go:\n```json\n{"a": "line one\nline two"}\n```';
    expect(firstJson(text)).toEqual({ a: "line one\nline two" });
  });

  it("leaves whitespace between tokens and escaped quotes alone", () => {
    const raw = '{\n\t"a": "say \\"hi\\"\nok",\n\t"b": 1\n}';
    expect(escapeControlCharsInStrings(raw)).toBe(
      '{\n\t"a": "say \\"hi\\"\\nok",\n\t"b": 1\n}',
    );
    expect(firstJson(raw)).toEqual({ a: 'say "hi"\nok', b: 1 });
  });

  it("still throws on text with no JSON", () => {
    expect(() => firstJson("no json here")).toThrow(/Could not parse JSON/);
  });
});
