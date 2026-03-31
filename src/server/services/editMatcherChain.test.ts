import { describe, it, expect } from "vitest";
import {
  exactMatch,
  whitespaceNormalizedMatch,
  quoteNormalizedMatch,
  indentFlexibleMatch,
  lineTrimmedMatch,
  fuzzyLineMatch,
  lineNumberAnchoredMatch,
  similarityMatch,
  wholeBlockMatch,
  levenshteinDistance,
  levenshteinSimilarity,
  runEditMatcherChain,
} from "./editMatcherChain";

// ---------------------------------------------------------------------------
// levenshteinDistance & levenshteinSimilarity
// ---------------------------------------------------------------------------

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns correct distance for single edit", () => {
    expect(levenshteinDistance("kitten", "sitten")).toBe(1);
  });

  it("returns length when comparing with empty string", () => {
    expect(levenshteinDistance("abc", "")).toBe(3);
    expect(levenshteinDistance("", "xyz")).toBe(3);
  });

  it("handles multi-edit distances", () => {
    expect(levenshteinDistance("saturday", "sunday")).toBe(3);
  });
});

describe("levenshteinSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(levenshteinSimilarity("abc", "abc")).toBe(1);
  });

  it("returns 1 for two empty strings", () => {
    expect(levenshteinSimilarity("", "")).toBe(1);
  });

  it("returns a value between 0 and 1", () => {
    const sim = levenshteinSimilarity("hello", "hallo");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it("returns 0 for completely different strings of same length", () => {
    const sim = levenshteinSimilarity("abc", "xyz");
    expect(sim).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// exactMatch
// ---------------------------------------------------------------------------

describe("exactMatch", () => {
  it("finds an exact substring", () => {
    const content = "const x = 42;\nconst y = 99;\n";
    const result = exactMatch(content, "const y = 99;");
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(1);
    expect(result!.matcherName).toBe("exactMatch");
    expect(result!.matchedText).toBe("const y = 99;");
  });

  it("returns null when not found", () => {
    expect(exactMatch("hello world", "foo bar")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// whitespaceNormalizedMatch
// ---------------------------------------------------------------------------

describe("whitespaceNormalizedMatch", () => {
  it("matches when tabs differ from spaces", () => {
    const content = "if (a\t=== b) {";
    const search = "if (a === b) {";
    const result = whitespaceNormalizedMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(2);
    expect(result!.matchedText).toBe("if (a\t=== b) {");
  });

  it("matches when multiple spaces differ", () => {
    const content = "x  =  1";
    const search = "x = 1";
    const result = whitespaceNormalizedMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matchedText).toBe("x  =  1");
  });

  it("returns null when content truly differs", () => {
    expect(whitespaceNormalizedMatch("foo bar", "baz qux")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// indentFlexibleMatch
// ---------------------------------------------------------------------------

describe("indentFlexibleMatch", () => {
  it("matches with different indentation levels", () => {
    const content = "    function hello() {\n        return 1;\n    }";
    const search = "function hello() {\n    return 1;\n}";
    const result = indentFlexibleMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(3);
    expect(result!.matcherName).toBe("indentFlexibleMatch");
  });

  it("returns null when lines differ beyond indentation", () => {
    const content = "    function hello() {}";
    const search = "function goodbye() {}";
    expect(indentFlexibleMatch(content, search)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lineTrimmedMatch
// ---------------------------------------------------------------------------

describe("lineTrimmedMatch", () => {
  it("matches with trailing whitespace differences", () => {
    const content = "const a = 1;   \nconst b = 2;  ";
    const search = "const a = 1;\nconst b = 2;";
    const result = lineTrimmedMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(4);
    expect(result!.matcherName).toBe("lineTrimmedMatch");
  });

  it("returns null when lines differ in non-whitespace content", () => {
    expect(lineTrimmedMatch("const a = 1;", "const a = 2;")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fuzzyLineMatch
// ---------------------------------------------------------------------------

describe("fuzzyLineMatch", () => {
  it("matches when searchText has one extra line not in content", () => {
    const content = "line1\nline2\nline4";
    const search = "line1\nline2\nline3\nline4";
    const result = fuzzyLineMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(5);
    expect(result!.matcherName).toBe("fuzzyLineMatch");
  });

  it("matches when content has one extra line not in searchText", () => {
    const content = "line1\nline2\nlineEXTRA\nline3";
    const search = "line1\nline2\nline3";
    const result = fuzzyLineMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(5);
  });

  it("returns null for single-line searchText", () => {
    expect(fuzzyLineMatch("hello", "hello")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lineNumberAnchoredMatch
// ---------------------------------------------------------------------------

describe("lineNumberAnchoredMatch", () => {
  it("uses // line N: hint to find closest occurrence", () => {
    const content = "a = 1\nb = 2\nc = 3\na = 1\ne = 5";
    const search = "// line 4:\na = 1";
    const result = lineNumberAnchoredMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(6);
    // Should pick the occurrence on line 4, not line 1
    expect(result!.startIndex).toBe(content.lastIndexOf("a = 1"));
  });

  it("uses # line N: hint", () => {
    const content = "x = 1\ny = 2\nx = 1";
    const search = "# line 1:\nx = 1";
    const result = lineNumberAnchoredMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.startIndex).toBe(0);
  });

  it("returns null when no line-number comment present", () => {
    expect(lineNumberAnchoredMatch("hello", "hello")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// similarityMatch
// ---------------------------------------------------------------------------

describe("similarityMatch", () => {
  it("matches with minor typo differences", () => {
    const content = 'console.log("hello world");';
    const search = 'console.log("hello wrold");'; // typo: wrold
    const result = similarityMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(7);
    expect(result!.matcherName).toBe("similarityMatch");
  });

  it("returns null when similarity is below threshold", () => {
    expect(similarityMatch("abcdefgh", "zzzzzzzz")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wholeBlockMatch
// ---------------------------------------------------------------------------

describe("wholeBlockMatch", () => {
  it("matches function declarations by first line", () => {
    const content = "// utils\nfunction add(a, b) {\n  return a + b;\n}\n";
    const search = "function add(a, b) {\n  return a + b;\n  // extra\n}";
    const result = wholeBlockMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(8);
    expect(result!.matcherName).toBe("wholeBlockMatch");
    expect(result!.matchedText).toBe("function add(a, b) {");
  });

  it("matches export declarations", () => {
    const content = "import x from 'y';\nexport const foo = 42;\n";
    const search = "export const foo = 42;\n// updated";
    const result = wholeBlockMatch(content, search);
    expect(result).not.toBeNull();
  });

  it("returns null for non-block searchText", () => {
    expect(wholeBlockMatch("hello world", "hello world")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runEditMatcherChain
// ---------------------------------------------------------------------------

describe("runEditMatcherChain", () => {
  it("prefers exact match over fuzzy", () => {
    const content = "const x = 1;";
    const result = runEditMatcherChain(content, "const x = 1;", "const x = 2;");
    expect(result.success).toBe(true);
    expect(result.match!.matcherLevel).toBe(1);
    expect(result.match!.matcherName).toBe("exactMatch");
    expect(result.content).toBe("const x = 2;");
  });

  it("falls through to whitespace-normalized when exact fails", () => {
    const content = "if (a\t===\tb) {}";
    const result = runEditMatcherChain(content, "if (a === b) {}", "if (a !== b) {}");
    expect(result.success).toBe(true);
    expect(result.match!.matcherLevel).toBe(2);
    expect(result.content).toBe("if (a !== b) {}");
  });

  it("falls through to indent-flexible match", () => {
    const content = "    return 42;";
    const search = "return 42;";
    const replace = "return 99;";
    const result = runEditMatcherChain(content, search, replace);
    expect(result.success).toBe(true);
    // May match at level 2 (whitespace normalized) or 3 (indent flexible);
    // both are valid since leading spaces are whitespace
    expect(result.match!.matcherLevel).toBeLessThanOrEqual(3);
  });

  it("returns correct content after replacement", () => {
    const content = "line1\nold line\nline3";
    const result = runEditMatcherChain(content, "old line", "new line");
    expect(result.success).toBe(true);
    expect(result.content).toBe("line1\nnew line\nline3");
  });

  it("returns failure when no matcher succeeds", () => {
    const content = "hello world";
    const result = runEditMatcherChain(content, "completely different text that is nowhere to be found in the content at all", "replacement");
    expect(result.success).toBe(false);
    expect(result.content).toBe(content);
    expect(result.match).toBeNull();
  });

  it("replaces at the correct position in multi-occurrence content", () => {
    const content = "aaa bbb aaa";
    const result = runEditMatcherChain(content, "aaa", "ccc");
    expect(result.success).toBe(true);
    // exactMatch finds first occurrence
    expect(result.content).toBe("ccc bbb aaa");
  });
});

// ---------------------------------------------------------------------------
// quoteNormalizedMatch
// ---------------------------------------------------------------------------

describe("quoteNormalizedMatch", () => {
  it("matches curly single quotes against straight", () => {
    const content = "const msg = 'hello world';";
    const search = "const msg = \u2018hello world\u2019;"; // curly quotes
    const result = quoteNormalizedMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(2);
    expect(result!.matcherName).toBe("quoteNormalizedMatch");
  });

  it("matches curly double quotes against straight", () => {
    const content = 'console.log("test");';
    const search = 'console.log(\u201Ctest\u201D);'; // curly double quotes
    const result = quoteNormalizedMatch(content, search);
    expect(result).not.toBeNull();
    expect(result!.matcherLevel).toBe(2);
  });

  it("returns null when content differs beyond quotes", () => {
    const content = "const x = 1;";
    const search = "const y = 2;"; // different content
    const result = quoteNormalizedMatch(content, search);
    expect(result).toBeNull();
  });

  it("handles em-dash vs hyphen", () => {
    const content = "// TODO: fix this-now";
    const search = "// TODO: fix this\u2014now"; // em-dash U+2014
    const result = quoteNormalizedMatch(content, search);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// levenshteinDistance with maxDistance
// ---------------------------------------------------------------------------

describe("levenshteinDistance with maxDistance", () => {
  it("returns Infinity when length difference exceeds maxDistance", () => {
    const a = "short";
    const b = "much longer string";
    const result = levenshteinDistance(a, b, 5);
    expect(result).toBe(Infinity);
  });

  it("returns Infinity when actual distance exceeds maxDistance", () => {
    const a = "hello";
    const b = "zzzzz";
    // Distance is 5, max is 2
    const result = levenshteinDistance(a, b, 2);
    expect(result).toBe(Infinity);
  });

  it("returns actual distance when within maxDistance", () => {
    const a = "kitten";
    const b = "sitten";
    // Distance is 1, max is 2
    const result = levenshteinDistance(a, b, 2);
    expect(result).toBe(1);
  });

  it("backward compatible (no maxDistance = full computation)", () => {
    const a = "saturday";
    const b = "sunday";
    const withMax = levenshteinDistance(a, b);
    const withoutMax = levenshteinDistance(a, b, undefined);
    expect(withMax).toBe(3);
    expect(withoutMax).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// levenshteinSimilarity with minSimilarity
// ---------------------------------------------------------------------------

describe("levenshteinSimilarity with minSimilarity", () => {
  it("returns 0 when below minSimilarity threshold", () => {
    const a = "hello";
    const b = "zzzzz";
    // These are very different, similarity would be low
    const result = levenshteinSimilarity(a, b, 0.8);
    expect(result).toBe(0);
  });

  it("returns actual similarity when above threshold", () => {
    const a = "hello";
    const b = "hallo";
    // Distance is 1, length is 5, similarity = 1 - 1/5 = 0.8
    const result = levenshteinSimilarity(a, b, 0.7);
    expect(result).toBeCloseTo(0.8);
  });
});
