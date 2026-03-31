/**
 * EditMatcherChain — chain-of-responsibility pattern for matching and applying
 * search-replace edits with progressively relaxed matching strategies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditMatch {
  matcherLevel: number;
  matcherName: string;
  startIndex: number;
  endIndex: number;
  matchedText: string;
}

export interface EditMatchResult {
  success: boolean;
  content: string;
  match: EditMatch | null;
}

// ---------------------------------------------------------------------------
// Levenshtein helpers
// ---------------------------------------------------------------------------

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

export function levenshteinSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Collapse all whitespace runs (spaces, tabs, etc.) to a single space. */
function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ");
}

/** Normalize curly/smart quotes to straight ASCII quotes. */
function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // curly single quotes → straight
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // curly double quotes → straight
    .replace(/[\u2013\u2014]/g, "-");              // en/em dashes → hyphen
}

/** Build a mapping from collapsed-string index back to original-string index. */
function buildCollapseMap(original: string): number[] {
  const map: number[] = [];
  let i = 0;
  while (i < original.length) {
    if (original[i] === " " || original[i] === "\t") {
      map.push(i); // the collapsed single space maps to first ws char
      while (i < original.length && (original[i] === " " || original[i] === "\t")) {
        i++;
      }
    } else {
      map.push(i);
      i++;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

export function exactMatch(content: string, searchText: string): EditMatch | null {
  const idx = content.indexOf(searchText);
  if (idx === -1) return null;
  return {
    matcherLevel: 1,
    matcherName: "exactMatch",
    startIndex: idx,
    endIndex: idx + searchText.length,
    matchedText: content.slice(idx, idx + searchText.length),
  };
}

export function quoteNormalizedMatch(
  content: string,
  searchText: string,
): EditMatch | null {
  const normalizedSearch = normalizeQuotes(searchText);
  const normalizedContent = normalizeQuotes(content);

  // If normalization didn't change anything, skip (exactMatch already tried)
  if (normalizedSearch === searchText && normalizedContent === content) return null;

  const idx = normalizedContent.indexOf(normalizedSearch);
  if (idx === -1) return null;

  // The index in normalized space maps 1:1 to original space
  // (quote normalization preserves string length for single-char replacements)
  return {
    matcherLevel: 2,
    matcherName: "quoteNormalizedMatch",
    startIndex: idx,
    endIndex: idx + normalizedSearch.length,
    matchedText: content.slice(idx, idx + normalizedSearch.length),
  };
}

export function whitespaceNormalizedMatch(
  content: string,
  searchText: string,
): EditMatch | null {
  const collapsedSearch = collapseWhitespace(searchText);
  const collapsedContent = collapseWhitespace(content);
  const idx = collapsedContent.indexOf(collapsedSearch);
  if (idx === -1) return null;

  // Map collapsed indices back to original content
  const map = buildCollapseMap(content);
  const origStart = map[idx];
  const collapsedEnd = idx + collapsedSearch.length;
  // Find original end: map the last collapsed char then advance past it in original
  let origEnd: number;
  if (collapsedEnd >= map.length) {
    origEnd = content.length;
  } else {
    origEnd = map[collapsedEnd];
  }

  return {
    matcherLevel: 2,
    matcherName: "whitespaceNormalizedMatch",
    startIndex: origStart,
    endIndex: origEnd,
    matchedText: content.slice(origStart, origEnd),
  };
}

export function indentFlexibleMatch(
  content: string,
  searchText: string,
): EditMatch | null {
  const stripIndent = (s: string) =>
    s
      .split("\n")
      .map((l) => l.replace(/^[ \t]*/, ""))
      .join("\n");

  const strippedSearch = stripIndent(searchText);
  const strippedContent = stripIndent(content);
  const idx = strippedContent.indexOf(strippedSearch);
  if (idx === -1) return null;

  // Map stripped index back to original content.
  // Build a mapping from stripped-content char index to original char index.
  const contentLines = content.split("\n");
  const origPositions: number[] = [];
  let origOffset = 0;
  for (let li = 0; li < contentLines.length; li++) {
    const line = contentLines[li];
    const stripped = line.replace(/^[ \t]*/, "");
    const indentLen = line.length - stripped.length;
    for (let ci = 0; ci < stripped.length; ci++) {
      origPositions.push(origOffset + indentLen + ci);
    }
    origOffset += line.length;
    if (li < contentLines.length - 1) {
      origPositions.push(origOffset); // newline char
      origOffset += 1; // for the \n
    }
  }

  const origStart = origPositions[idx] ?? 0;
  const endIdx = idx + strippedSearch.length;
  const origEnd = endIdx < origPositions.length ? origPositions[endIdx] : content.length;

  return {
    matcherLevel: 3,
    matcherName: "indentFlexibleMatch",
    startIndex: origStart,
    endIndex: origEnd,
    matchedText: content.slice(origStart, origEnd),
  };
}

export function lineTrimmedMatch(
  content: string,
  searchText: string,
): EditMatch | null {
  const trimLines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .join("\n");

  const trimmedSearch = trimLines(searchText);
  const trimmedContent = trimLines(content);
  const idx = trimmedContent.indexOf(trimmedSearch);
  if (idx === -1) return null;

  // Map trimmed index to original index
  const contentLines = content.split("\n");
  const origPositions: number[] = [];
  let origOffset = 0;
  for (let li = 0; li < contentLines.length; li++) {
    const line = contentLines[li];
    const trimmed = line.trim();
    const leadingLen = line.length - line.trimStart().length;
    for (let ci = 0; ci < trimmed.length; ci++) {
      origPositions.push(origOffset + leadingLen + ci);
    }
    origOffset += line.length;
    if (li < contentLines.length - 1) {
      origPositions.push(origOffset); // newline
      origOffset += 1;
    }
  }

  const origStart = origPositions[idx] ?? 0;
  const endIdx = idx + trimmedSearch.length;
  const origEnd = endIdx < origPositions.length ? origPositions[endIdx] : content.length;

  return {
    matcherLevel: 4,
    matcherName: "lineTrimmedMatch",
    startIndex: origStart,
    endIndex: origEnd,
    matchedText: content.slice(origStart, origEnd),
  };
}

export function fuzzyLineMatch(
  content: string,
  searchText: string,
): EditMatch | null {
  const searchLines = searchText.split("\n");
  if (searchLines.length < 2) return null;

  // Try removing each line one at a time
  for (let skip = 0; skip < searchLines.length; skip++) {
    const reduced = searchLines.filter((_, i) => i !== skip).join("\n");
    const idx = content.indexOf(reduced);
    if (idx !== -1) {
      return {
        matcherLevel: 5,
        matcherName: "fuzzyLineMatch",
        startIndex: idx,
        endIndex: idx + reduced.length,
        matchedText: content.slice(idx, idx + reduced.length),
      };
    }
  }

  // Also try: content has an extra line compared to searchText
  const contentLines = content.split("\n");
  for (let ci = 0; ci <= contentLines.length - searchLines.length; ci++) {
    // Try matching searchLines against contentLines[ci..ci+searchLines.length+1] with one skip
    const window = contentLines.slice(ci, ci + searchLines.length + 1);
    for (let skip = 0; skip < window.length; skip++) {
      const reduced = window.filter((_, i) => i !== skip).join("\n");
      if (reduced === searchText) {
        const startIdx = contentLines.slice(0, ci).join("\n").length + (ci > 0 ? 1 : 0);
        const matchedText = window.join("\n");
        return {
          matcherLevel: 5,
          matcherName: "fuzzyLineMatch",
          startIndex: startIdx,
          endIndex: startIdx + matchedText.length,
          matchedText,
        };
      }
    }
  }

  return null;
}

export function lineNumberAnchoredMatch(
  content: string,
  searchText: string,
): EditMatch | null {
  // Check if searchText starts with a line-number comment
  const lineNumPattern = /^(?:\/\/|#)\s*line\s+(\d+)\s*:\s*\n?/;
  const m = searchText.match(lineNumPattern);
  if (!m) return null;

  const hintLine = parseInt(m[1], 10);
  const actualSearch = searchText.slice(m[0].length);
  if (!actualSearch) return null;

  // Find all occurrences
  const occurrences: number[] = [];
  let pos = 0;
  while (true) {
    const idx = content.indexOf(actualSearch, pos);
    if (idx === -1) break;
    occurrences.push(idx);
    pos = idx + 1;
  }
  if (occurrences.length === 0) return null;

  // Pick the occurrence closest to hintLine
  const lineOfIndex = (idx: number): number => {
    let line = 1;
    for (let i = 0; i < idx; i++) {
      if (content[i] === "\n") line++;
    }
    return line;
  };

  let bestIdx = occurrences[0];
  let bestDist = Math.abs(lineOfIndex(bestIdx) - hintLine);
  for (let i = 1; i < occurrences.length; i++) {
    const dist = Math.abs(lineOfIndex(occurrences[i]) - hintLine);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = occurrences[i];
    }
  }

  return {
    matcherLevel: 6,
    matcherName: "lineNumberAnchoredMatch",
    startIndex: bestIdx,
    endIndex: bestIdx + actualSearch.length,
    matchedText: content.slice(bestIdx, bestIdx + actualSearch.length),
  };
}

export function similarityMatch(
  content: string,
  searchText: string,
): EditMatch | null {
  const threshold = 0.85;
  const searchLen = searchText.length;
  if (searchLen === 0) return null;

  let bestSim = 0;
  let bestIdx = -1;

  // Slide a window of roughly searchLen across content, allowing +/- 10% variance
  const minWin = Math.max(1, Math.floor(searchLen * 0.9));
  const maxWin = Math.ceil(searchLen * 1.1);

  for (let winSize = minWin; winSize <= maxWin; winSize++) {
    for (let i = 0; i <= content.length - winSize; i++) {
      const window = content.slice(i, i + winSize);
      const sim = levenshteinSimilarity(window, searchText);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
  }

  if (bestSim < threshold || bestIdx === -1) return null;

  // Determine the actual window size that produced the best match
  let bestWinSize = searchLen;
  let recalcBest = 0;
  for (let winSize = minWin; winSize <= maxWin; winSize++) {
    if (bestIdx + winSize > content.length) continue;
    const window = content.slice(bestIdx, bestIdx + winSize);
    const sim = levenshteinSimilarity(window, searchText);
    if (sim > recalcBest) {
      recalcBest = sim;
      bestWinSize = winSize;
    }
  }

  return {
    matcherLevel: 7,
    matcherName: "similarityMatch",
    startIndex: bestIdx,
    endIndex: bestIdx + bestWinSize,
    matchedText: content.slice(bestIdx, bestIdx + bestWinSize),
  };
}

export function wholeBlockMatch(
  content: string,
  searchText: string,
): EditMatch | null {
  const blockPrefixes = ["function", "class", "export", "const", "def", "pub fn"];
  const firstLine = searchText.split("\n")[0].trimStart();
  const looksLikeBlock = blockPrefixes.some((p) => firstLine.startsWith(p));
  if (!looksLikeBlock) return null;

  // Find the declaration signature (first line) in content
  const contentLines = content.split("\n");
  const searchFirstTrimmed = firstLine.trim();

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== searchFirstTrimmed) continue;

    // Found declaration start — compute position
    const startIdx =
      contentLines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);

    return {
      matcherLevel: 8,
      matcherName: "wholeBlockMatch",
      startIndex: startIdx,
      endIndex: startIdx + contentLines[i].length,
      matchedText: contentLines[i],
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Chain runner
// ---------------------------------------------------------------------------

const matcherChain: Array<(content: string, searchText: string) => EditMatch | null> = [
  exactMatch,
  quoteNormalizedMatch,
  whitespaceNormalizedMatch,
  indentFlexibleMatch,
  lineTrimmedMatch,
  fuzzyLineMatch,
  lineNumberAnchoredMatch,
  similarityMatch,
  wholeBlockMatch,
];

export function runEditMatcherChain(
  content: string,
  searchText: string,
  replaceText: string,
): EditMatchResult {
  for (const matcher of matcherChain) {
    const match = matcher(content, searchText);
    if (match) {
      const newContent =
        content.slice(0, match.startIndex) +
        replaceText +
        content.slice(match.endIndex);
      return { success: true, content: newContent, match };
    }
  }
  return { success: false, content, match: null };
}
