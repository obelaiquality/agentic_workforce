/**
 * Token estimation utilities.
 *
 * Attempts to use tiktoken for high-confidence token counts,
 * falling back to a fast heuristic (~4 chars per token) when
 * tiktoken is not installed.
 */

export interface TokenEstimate {
  /** The estimated token count */
  count: number;
  /** Which estimation method was used */
  method: "tiktoken" | "heuristic";
  /** Confidence level of the estimate */
  confidence: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Tiktoken lazy loader
// ---------------------------------------------------------------------------

let cachedEncoder: { encode: (text: string) => { length: number } } | null =
  null;
let tiktokenLoadAttempted = false;

/**
 * Attempt to load tiktoken and cache the encoder for reuse.
 * Returns null if tiktoken is not available.
 */
async function getEncoder(): Promise<typeof cachedEncoder> {
  if (cachedEncoder) return cachedEncoder;
  if (tiktokenLoadAttempted) return null;

  tiktokenLoadAttempted = true;

  try {
    const tiktoken = await import("tiktoken");
    // cl100k_base covers GPT-4 / Claude-compatible tokenization
    const enc = tiktoken.encoding_for_model?.("gpt-4") ??
      tiktoken.get_encoding?.("cl100k_base");
    if (enc) {
      cachedEncoder = enc;
      return cachedEncoder;
    }
  } catch {
    // tiktoken not installed — fall back to heuristic
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimate token count with the best available method.
 *
 * Tries tiktoken first for a high-confidence count, then falls back
 * to the fast heuristic if tiktoken is not installed.
 */
export async function estimateTokensAccurate(
  text: string,
  _model?: string,
): Promise<TokenEstimate> {
  if (!text) {
    return { count: 0, method: "heuristic", confidence: "high" };
  }

  const encoder = await getEncoder();

  if (encoder) {
    try {
      const count = encoder.encode(text).length;
      return { count, method: "tiktoken", confidence: "high" };
    } catch {
      // Encoding failed — fall through to heuristic
    }
  }

  return {
    count: estimateTokensFast(text),
    method: "heuristic",
    confidence: "medium",
  };
}

/**
 * Fast heuristic token estimate (~4 characters per token).
 * Synchronous and allocation-free.
 */
export function estimateTokensFast(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Reset the cached encoder (for testing).
 */
export function resetEncoder(): void {
  cachedEncoder = null;
  tiktokenLoadAttempted = false;
}
