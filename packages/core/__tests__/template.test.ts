import { describe, it, expect } from "vitest";
import { renderTemplate, evaluateCondition, resolveExpression } from "../src/template.js";

describe("renderTemplate", () => {
  it("replaces simple variables", () => {
    expect(renderTemplate("Hello {{name}}", { name: "Alice" })).toBe("Hello Alice");
  });

  it("replaces dotted paths", () => {
    expect(renderTemplate("{{user.name}}", { user: { name: "Bob" } })).toBe("Bob");
  });

  it("replaces array indices", () => {
    const ctx = { items: [{ title: "First" }, { title: "Second" }] };
    expect(renderTemplate("{{items[0].title}}", ctx)).toBe("First");
    expect(renderTemplate("{{items[1].title}}", ctx)).toBe("Second");
  });

  it("replaces deeply nested paths", () => {
    const ctx = { a: { b: { c: { d: "deep" } } } };
    expect(renderTemplate("{{a.b.c.d}}", ctx)).toBe("deep");
  });

  it("replaces multiple templates in one string", () => {
    expect(renderTemplate("{{a}} and {{b}}", { a: "X", b: "Y" })).toBe("X and Y");
  });

  it("serializes objects as JSON", () => {
    const ctx = { data: { x: 1, y: 2 } };
    const result = renderTemplate("{{data}}", ctx);
    expect(JSON.parse(result)).toEqual({ x: 1, y: 2 });
  });

  it("replaces undefined values with empty string", () => {
    expect(renderTemplate("{{missing}}", {})).toBe("");
  });

  it("replaces null values with empty string", () => {
    expect(renderTemplate("{{val}}", { val: null })).toBe("");
  });

  it("handles numbers", () => {
    expect(renderTemplate("count: {{n}}", { n: 42 })).toBe("count: 42");
  });

  it("handles booleans", () => {
    expect(renderTemplate("{{flag}}", { flag: true })).toBe("true");
  });

  it("returns empty when traversing through non-object value", () => {
    // a.b is a string, not an object, so a.b.c can't resolve
    expect(renderTemplate("{{a.b.c}}", { a: { b: "string" } })).toBe("");
  });

  it("returns empty for path through primitive", () => {
    expect(renderTemplate("{{x.y}}", { x: 42 })).toBe("");
  });

  it("handles no template expressions", () => {
    expect(renderTemplate("plain text", {})).toBe("plain text");
  });
});

describe("evaluateCondition", () => {
  it("returns true for truthy value", () => {
    expect(evaluateCondition("flag", { flag: true })).toBe(true);
    expect(evaluateCondition("count", { count: 5 })).toBe(true);
    expect(evaluateCondition("name", { name: "alice" })).toBe(true);
  });

  it("returns false for falsy value", () => {
    expect(evaluateCondition("flag", { flag: false })).toBe(false);
    expect(evaluateCondition("missing", {})).toBe(false);
    expect(evaluateCondition("val", { val: 0 })).toBe(false);
    expect(evaluateCondition("val", { val: "" })).toBe(false);
  });

  it("negates with !", () => {
    expect(evaluateCondition("!flag", { flag: true })).toBe(false);
    expect(evaluateCondition("!flag", { flag: false })).toBe(true);
    expect(evaluateCondition("!missing", {})).toBe(true);
  });

  it("handles dotted paths", () => {
    expect(evaluateCondition("review.approved", { review: { approved: true } })).toBe(true);
    expect(evaluateCondition("!review.approved", { review: { approved: false } })).toBe(true);
  });

  it("handles whitespace", () => {
    expect(evaluateCondition("  flag  ", { flag: true })).toBe(true);
    expect(evaluateCondition("  ! flag  ", { flag: true })).toBe(false);
  });
});

describe("resolveExpression", () => {
  it("resolves simple key", () => {
    expect(resolveExpression("name", { name: "Alice" })).toBe("Alice");
  });

  it("resolves dotted path", () => {
    expect(resolveExpression("user.name", { user: { name: "Bob" } })).toBe("Bob");
  });

  it("returns undefined for missing path", () => {
    expect(resolveExpression("missing.key", {})).toBeUndefined();
  });

  it("resolves array index", () => {
    const ctx = { items: ["a", "b", "c"] };
    expect(resolveExpression("items[1]", ctx)).toBe("b");
  });
});
