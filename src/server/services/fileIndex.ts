/**
 * Pure-TypeScript fuzzy file finder inspired by nucleo (Helix editor) and fzf.
 *
 * Key API:
 *   new FileIndex()
 *   .loadFromFileList(files: string[]): void
 *   .loadFromFileListAsync(files: string[]): { queryable, done }
 *   .search(query: string, limit: number): SearchResult[]
 *
 * Scoring: higher = better match. Best match approaches SCORE_MATCH * queryLen.
 * Paths containing "test" / ".spec." get a slight penalty so production code
 * ranks higher for ambiguous queries.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  path: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Scoring Constants (nucleo-style)
// ---------------------------------------------------------------------------

const SCORE_MATCH = 16;
const BONUS_BOUNDARY = 8;
const BONUS_CAMEL = 6;
const BONUS_CONSECUTIVE = 4;
const BONUS_FIRST_CHAR = 8;
const PENALTY_GAP_START = 3;
const PENALTY_GAP_EXTENSION = 1;

const MAX_QUERY_LEN = 64;
const CHUNK_MS = 4;
const TOP_LEVEL_CACHE_LIMIT = 100;

// Reusable buffer for match positions during indexOf scan
const posBuf = new Int32Array(MAX_QUERY_LEN);

// ---------------------------------------------------------------------------
// FileIndex
// ---------------------------------------------------------------------------

export class FileIndex {
  private paths: string[] = [];
  private lowerPaths: string[] = [];
  private charBits: Int32Array = new Int32Array(0);
  private pathLens: Uint16Array = new Uint16Array(0);
  private topLevelCache: SearchResult[] | null = null;
  private readyCount = 0;

  /**
   * Synchronously load and index file paths.
   * Deduplicates automatically.
   */
  loadFromFileList(fileList: string[]): void {
    const paths = dedup(fileList);
    this.buildIndex(paths);
  }

  /**
   * Asynchronously load and index file paths, yielding to the event loop
   * every ~4ms so large indexes (200k+ files) don't block the main thread.
   *
   * Returns:
   *   - queryable: resolves as soon as the first chunk is indexed (partial search works)
   *   - done: resolves when the entire index is built
   */
  loadFromFileListAsync(fileList: string[]): {
    queryable: Promise<void>;
    done: Promise<void>;
  } {
    let markQueryable: () => void = () => {};
    const queryable = new Promise<void>((resolve) => {
      markQueryable = resolve;
    });
    const done = this.buildAsync(fileList, markQueryable);
    return { queryable, done };
  }

  /**
   * Fuzzy search for files matching the query.
   * Returns up to `limit` results sorted by score (best first).
   */
  search(query: string, limit: number): SearchResult[] {
    if (limit <= 0) return [];
    if (query.length === 0) {
      return this.topLevelCache ? this.topLevelCache.slice(0, limit) : [];
    }

    // Smart case: lowercase query → case-insensitive; any uppercase → case-sensitive
    const caseSensitive = query !== query.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    const nLen = Math.min(needle.length, MAX_QUERY_LEN);

    // Pre-compute needle characters and bitmap
    const needleChars: string[] = new Array(nLen);
    let needleBitmap = 0;
    for (let j = 0; j < nLen; j++) {
      const ch = needle.charAt(j);
      needleChars[j] = ch;
      const cc = ch.charCodeAt(0);
      if (cc >= 97 && cc <= 122) needleBitmap |= 1 << (cc - 97);
    }

    // Upper bound on score for early rejection
    const scoreCeiling =
      nLen * (SCORE_MATCH + BONUS_BOUNDARY) + BONUS_FIRST_CHAR + 32;

    // Top-k maintenance: sorted ascending array, shift worst when inserting better
    const topK: { path: string; fuzzScore: number }[] = [];
    let threshold = -Infinity;

    const { paths, lowerPaths, charBits, pathLens, readyCount } = this;

    outer: for (let i = 0; i < readyCount; i++) {
      // O(1) bitmap rejection: path must contain every a-z letter in the needle
      if ((charBits[i]! & needleBitmap) !== needleBitmap) continue;

      const haystack = caseSensitive ? paths[i]! : lowerPaths[i]!;

      // Fused indexOf scan: find positions and accumulate gap/consecutive terms
      let pos = haystack.indexOf(needleChars[0]!);
      if (pos === -1) continue;
      posBuf[0] = pos;
      let gapPenalty = 0;
      let consecBonus = 0;
      let prev = pos;
      for (let j = 1; j < nLen; j++) {
        pos = haystack.indexOf(needleChars[j]!, prev + 1);
        if (pos === -1) continue outer;
        posBuf[j] = pos;
        const gap = pos - prev - 1;
        if (gap === 0) consecBonus += BONUS_CONSECUTIVE;
        else gapPenalty += PENALTY_GAP_START + gap * PENALTY_GAP_EXTENSION;
        prev = pos;
      }

      // Gap-bound reject: can this path beat the current threshold?
      if (
        topK.length === limit &&
        scoreCeiling + consecBonus - gapPenalty <= threshold
      ) {
        continue;
      }

      // Boundary/camelCase scoring
      const origPath = paths[i]!;
      const hLen = pathLens[i]!;
      let score = nLen * SCORE_MATCH + consecBonus - gapPenalty;
      score += scoreBonusAt(origPath, posBuf[0]!, true);
      for (let j = 1; j < nLen; j++) {
        score += scoreBonusAt(origPath, posBuf[j]!, false);
      }
      // Length bonus: shorter paths get a small boost
      score += Math.max(0, 32 - (hLen >> 2));

      // Insert into top-k
      if (topK.length < limit) {
        topK.push({ path: origPath, fuzzScore: score });
        if (topK.length === limit) {
          topK.sort((a, b) => a.fuzzScore - b.fuzzScore);
          threshold = topK[0]!.fuzzScore;
        }
      } else if (score > threshold) {
        // Binary search for insertion point
        let lo = 0;
        let hi = topK.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (topK[mid]!.fuzzScore < score) lo = mid + 1;
          else hi = mid;
        }
        topK.splice(lo, 0, { path: origPath, fuzzScore: score });
        topK.shift(); // remove worst
        threshold = topK[0]!.fuzzScore;
      }
    }

    // Sort descending (best first) and normalize scores
    topK.sort((a, b) => b.fuzzScore - a.fuzzScore);
    const matchCount = topK.length;
    const denom = Math.max(matchCount, 1);
    const results: SearchResult[] = new Array(matchCount);

    for (let i = 0; i < matchCount; i++) {
      const p = topK[i]!.path;
      const positionScore = i / denom;
      // Test file penalty: paths containing test/spec rank slightly lower
      const isTestFile = /[./](test|spec|__tests__)[./]/.test(p) || p.includes(".test.") || p.includes(".spec.");
      const finalScore = isTestFile
        ? Math.min(positionScore * 1.05, 1.0)
        : positionScore;
      results[i] = { path: p, score: finalScore };
    }

    return results;
  }

  /** Number of indexed files. */
  getFileCount(): number {
    return this.readyCount;
  }

  /** Whether the index has been built (at least partially). */
  isReady(): boolean {
    return this.readyCount > 0;
  }

  /** Clear the index and release memory. */
  clear(): void {
    this.paths = [];
    this.lowerPaths = [];
    this.charBits = new Int32Array(0);
    this.pathLens = new Uint16Array(0);
    this.topLevelCache = null;
    this.readyCount = 0;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private buildIndex(paths: string[]): void {
    this.resetArrays(paths);
    for (let i = 0; i < paths.length; i++) {
      this.indexPath(i);
    }
    this.readyCount = paths.length;
  }

  private async buildAsync(
    fileList: string[],
    markQueryable: () => void,
  ): Promise<void> {
    const paths = dedup(fileList);
    this.resetArrays(paths);

    let chunkStart = performance.now();
    let firstChunk = true;

    for (let i = 0; i < paths.length; i++) {
      this.indexPath(i);

      if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
        this.readyCount = i + 1;
        if (firstChunk) {
          markQueryable();
          firstChunk = false;
        }
        await yieldToEventLoop();
        chunkStart = performance.now();
      }
    }
    this.readyCount = paths.length;
    markQueryable();
  }

  private resetArrays(paths: string[]): void {
    const n = paths.length;
    this.paths = paths;
    this.lowerPaths = new Array(n);
    this.charBits = new Int32Array(n);
    this.pathLens = new Uint16Array(n);
    this.readyCount = 0;
    this.topLevelCache = computeTopLevelEntries(paths, TOP_LEVEL_CACHE_LIMIT);
  }

  /**
   * Pre-compute per-path data: lowercase, a-z bitmap, length.
   * Bitmap gives O(1) rejection of paths missing any needle letter.
   */
  private indexPath(i: number): void {
    const lp = this.paths[i]!.toLowerCase();
    this.lowerPaths[i] = lp;
    const len = lp.length;
    this.pathLens[i] = len;
    let bits = 0;
    for (let j = 0; j < len; j++) {
      const c = lp.charCodeAt(j);
      if (c >= 97 && c <= 122) bits |= 1 << (c - 97);
    }
    this.charBits[i] = bits;
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function scoreBonusAt(path: string, pos: number, first: boolean): number {
  if (pos === 0) return first ? BONUS_FIRST_CHAR : 0;
  const prevCh = path.charCodeAt(pos - 1);
  if (isBoundary(prevCh)) return BONUS_BOUNDARY;
  if (isLower(prevCh) && isUpper(path.charCodeAt(pos))) return BONUS_CAMEL;
  return 0;
}

function isBoundary(code: number): boolean {
  return code === 47 || code === 92 || code === 45 || code === 95 || code === 46 || code === 32;
  // /  \  -  _  .  space
}

function isLower(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isUpper(code: number): boolean {
  return code >= 65 && code <= 90;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function dedup(fileList: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of fileList) {
    if (line.length > 0 && !seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function computeTopLevelEntries(
  paths: string[],
  limit: number,
): SearchResult[] {
  const topLevel = new Set<string>();
  for (const p of paths) {
    let end = p.length;
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      if (c === 47 || c === 92) {
        end = i;
        break;
      }
    }
    const segment = p.slice(0, end);
    if (segment.length > 0) {
      topLevel.add(segment);
      if (topLevel.size >= limit) break;
    }
  }
  const sorted = Array.from(topLevel).sort((a, b) => {
    const lenDiff = a.length - b.length;
    return lenDiff !== 0 ? lenDiff : a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted.slice(0, limit).map((p) => ({ path: p, score: 0.0 }));
}

export default FileIndex;
