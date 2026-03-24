import { describe, expect, it } from "vitest";
import { sanitizeSvgMarkup } from "./sanitizeSvgMarkup";

describe("sanitizeSvgMarkup", () => {
  it("removes script tags and event handlers", () => {
    const input = `<svg onload="alert(1)"><script>alert(1)</script><rect onclick="hack()" /></svg>`;
    expect(sanitizeSvgMarkup(input)).not.toContain("<script");
    expect(sanitizeSvgMarkup(input)).not.toContain("onload=");
    expect(sanitizeSvgMarkup(input)).not.toContain("onclick=");
  });

  it("removes javascript urls", () => {
    const input = `<svg><a href="javascript:alert(1)">bad</a><use xlink:href="javascript:alert(2)" /></svg>`;
    const output = sanitizeSvgMarkup(input);
    expect(output).not.toContain("javascript:");
  });
});
