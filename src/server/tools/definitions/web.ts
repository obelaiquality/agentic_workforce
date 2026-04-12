/**
 * Web tools — HTTP fetch and web search capabilities for the agent.
 *
 * Tools:
 *   web_fetch  — Fetch a URL and extract text content
 *   web_search — Search the web via a configurable search API
 */

import { z } from "zod";
import type { ToolDefinition } from "../types";

// ---------------------------------------------------------------------------
// 1. web_fetch — Fetch a URL and extract text content
// ---------------------------------------------------------------------------

const webFetchSchema = z.object({
  url: z.string().url().describe("The URL to fetch"),
  method: z.enum(["GET", "POST"]).optional().default("GET").describe("HTTP method"),
  headers: z.record(z.string()).optional().describe("Optional HTTP headers"),
  body: z.string().optional().describe("Request body for POST requests"),
  max_length: z.number().optional().default(10000).describe("Maximum characters to return from the response body"),
});

/**
 * Strip HTML tags and decode common entities for a rough text extraction.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export const webFetch: ToolDefinition<z.infer<typeof webFetchSchema>> = {
  name: "web_fetch",
  description:
    "Fetch a URL and return its text content. Useful for reading documentation, API responses, or web pages. Strips HTML tags and returns plain text. Limited to 10KB by default.",
  inputSchema: webFetchSchema,
  permission: {
    scope: "network",
    requiresApproval: true,
  },
  alwaysLoad: false,
  concurrencySafe: true,

  async execute(input) {
    const { url, method, headers, body, max_length } = input;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method,
        headers: {
          "User-Agent": "AgenticWorkforce/1.0",
          ...(headers ?? {}),
        },
        body: method === "POST" ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          type: "error",
          error: `HTTP ${response.status} ${response.statusText}`,
          metadata: {
            status: response.status,
            statusText: response.statusText,
            url,
          },
        };
      }

      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();

      let content: string;
      if (contentType.includes("text/html")) {
        content = htmlToText(rawText);
      } else {
        content = rawText;
      }

      // Truncate to max_length
      const truncated = content.length > max_length;
      if (truncated) {
        content = content.slice(0, max_length) + "\n\n[Truncated — content exceeds max_length]";
      }

      return {
        type: "success",
        content,
        metadata: {
          url,
          status: response.status,
          contentType,
          contentLength: rawText.length,
          truncated,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("abort")) {
        return {
          type: "error",
          error: `Request timed out after 15 seconds: ${url}`,
        };
      }
      return {
        type: "error",
        error: `Fetch failed: ${message}`,
        metadata: { url },
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 2. web_search — Search the web
// ---------------------------------------------------------------------------

const webSearchSchema = z.object({
  query: z.string().min(1).describe("Search query"),
  max_results: z.number().optional().default(5).describe("Maximum number of results to return"),
});

/**
 * web_search performs a web search using a configurable backend.
 *
 * Currently supports:
 * - Environment variable SEARCH_API_URL for custom search endpoints
 * - Falls back to a DuckDuckGo HTML scrape for basic results
 */
export const webSearch: ToolDefinition<z.infer<typeof webSearchSchema>> = {
  name: "web_search",
  description:
    "Search the web for a query and return a list of results with titles, URLs, and snippets. Useful for finding documentation, solutions, or current information.",
  inputSchema: webSearchSchema,
  permission: {
    scope: "network",
    requiresApproval: true,
  },
  alwaysLoad: false,
  concurrencySafe: true,

  async execute(input) {
    const { query, max_results } = input;

    try {
      // Check for custom search API
      const customApiUrl = process.env.SEARCH_API_URL;
      if (customApiUrl) {
        return await searchViaCustomApi(customApiUrl, query, max_results);
      }

      // Fallback: DuckDuckGo HTML search
      return await searchViaDuckDuckGo(query, max_results);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Search failed: ${message}`,
        metadata: { query },
      };
    }
  },
};

async function searchViaCustomApi(
  apiUrl: string,
  query: string,
  maxResults: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: maxResults }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    return {
      type: "error" as const,
      error: `Search API returned HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { results?: Array<{ title: string; url: string; snippet: string }> };
  const results = (data.results ?? []).slice(0, maxResults);

  const content = results
    .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");

  return {
    type: "success" as const,
    content: content || "No results found.",
    metadata: {
      query,
      resultCount: results.length,
      source: "custom_api",
    },
  };
}

async function searchViaDuckDuckGo(query: string, maxResults: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const encodedQuery = encodeURIComponent(query);
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQuery}`, {
    headers: {
      "User-Agent": "AgenticWorkforce/1.0",
    },
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    return {
      type: "error" as const,
      error: `DuckDuckGo returned HTTP ${response.status}`,
    };
  }

  const html = await response.text();

  // Extract results from DuckDuckGo HTML
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
    const rawUrl = match[1];
    const title = htmlToText(match[2]);
    const snippet = htmlToText(match[3]);

    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
    const urlMatch = rawUrl.match(/uddg=([^&]+)/);
    const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  const content = results.length > 0
    ? results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n")
    : "No results found for this query.";

  return {
    type: "success" as const,
    content,
    metadata: {
      query,
      resultCount: results.length,
      source: "duckduckgo",
    },
  };
}

// Export htmlToText for testing
export { htmlToText };
