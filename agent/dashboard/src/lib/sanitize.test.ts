import { describe, it, expect } from "vitest";
import { sanitizeMarkdown } from "./sanitize";

describe("sanitizeMarkdown", () => {
  it("renders basic markdown to HTML", () => {
    const html = sanitizeMarkdown("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders code blocks", () => {
    const html = sanitizeMarkdown("```js\nconsole.log('hi');\n```");
    expect(html).toContain("<code");
    expect(html).toContain("console.log");
  });

  it("renders inline code", () => {
    const html = sanitizeMarkdown("use `foo()` here");
    expect(html).toContain("<code>foo()</code>");
  });

  it("strips iframe tags", () => {
    const html = sanitizeMarkdown('<iframe src="https://evil.com"></iframe>');
    expect(html).not.toContain("iframe");
    expect(html).not.toContain("evil.com");
  });

  it("strips img tags (prevents tracking beacons)", () => {
    const html = sanitizeMarkdown('<img src="https://tracker.com/pixel.png">');
    expect(html).not.toContain("img");
    expect(html).not.toContain("tracker.com");
  });

  it("strips markdown image syntax (rendered as img then stripped)", () => {
    const html = sanitizeMarkdown("![alt](https://tracker.com/pixel.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("tracker.com");
  });

  it("strips object and embed tags", () => {
    const html = sanitizeMarkdown('<object data="x"></object><embed src="y">');
    expect(html).not.toContain("object");
    expect(html).not.toContain("embed");
  });

  it("strips form tags", () => {
    const html = sanitizeMarkdown('<form action="/steal"><input></form>');
    expect(html).not.toContain("form");
    expect(html).not.toContain("/steal");
  });

  it("strips data attributes", () => {
    const html = sanitizeMarkdown('<div data-secret="key123">text</div>');
    expect(html).not.toContain("data-secret");
    expect(html).not.toContain("key123");
  });

  it("strips srcset attributes", () => {
    const html = sanitizeMarkdown('<img srcset="a.png 1x, b.png 2x">');
    expect(html).not.toContain("srcset");
  });

  it("allows safe HTML: links, lists, headings", () => {
    const html = sanitizeMarkdown("# Title\n\n- item 1\n- item 2\n\n[link](https://example.com)");
    expect(html).toContain("<h1");
    expect(html).toContain("<li>");
    expect(html).toContain('<a href="https://example.com"');
  });

  it("strips script tags (XSS)", () => {
    const html = sanitizeMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain("script");
    expect(html).not.toContain("alert");
  });

  it("strips onerror attributes (XSS)", () => {
    const html = sanitizeMarkdown('<div onerror="alert(1)">test</div>');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert");
  });

  it("handles empty string", () => {
    const html = sanitizeMarkdown("");
    expect(html).toBe("");
  });
});
