import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webFetch, webSearch, htmlToText } from "./web";

describe("web tools", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("htmlToText", () => {
    it("strips HTML tags", () => {
      expect(htmlToText("<p>Hello <b>World</b></p>")).toBe("Hello World");
    });

    it("removes script and style tags with content", () => {
      const html = '<div>Text <script>alert("x")</script><style>.a{}</style> More</div>';
      expect(htmlToText(html)).toBe("Text More");
    });

    it("decodes common entities", () => {
      expect(htmlToText("&amp; &lt; &gt; &quot; &#39;")).toBe('& < > " \'');
    });

    it("removes nav, footer, header elements", () => {
      const html = "<nav>Nav</nav><main>Content</main><footer>Foot</footer>";
      expect(htmlToText(html)).toBe("Content");
    });

    it("collapses whitespace", () => {
      expect(htmlToText("  hello   world  ")).toBe("hello world");
    });
  });

  describe("webFetch", () => {
    it("has correct tool metadata", () => {
      expect(webFetch.name).toBe("web_fetch");
      expect(webFetch.permission.scope).toBe("network");
      expect(webFetch.permission.requiresApproval).toBe(true);
      expect(webFetch.concurrencySafe).toBe(true);
    });

    it("fetches a URL and returns text content", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("Hello World"),
      });

      const result = await webFetch.execute(
        { url: "https://example.com/test.txt", method: "GET", max_length: 10000 },
        {} as any,
      );

      expect(result.type).toBe("success");
      expect(result.content).toBe("Hello World");
      expect(result.metadata?.status).toBe(200);
    });

    it("strips HTML when content-type is text/html", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: () => Promise.resolve("<html><body><p>Hello</p></body></html>"),
      });

      const result = await webFetch.execute(
        { url: "https://example.com", method: "GET", max_length: 10000 },
        {} as any,
      );

      expect(result.type).toBe("success");
      expect(result.content).toBe("Hello");
    });

    it("truncates content exceeding max_length", async () => {
      const longText = "x".repeat(200);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve(longText),
      });

      const result = await webFetch.execute(
        { url: "https://example.com", method: "GET", max_length: 50 },
        {} as any,
      );

      expect(result.type).toBe("success");
      expect(result.content).toContain("[Truncated");
      expect(result.metadata?.truncated).toBe(true);
    });

    it("returns error for non-OK responses", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers(),
      });

      const result = await webFetch.execute(
        { url: "https://example.com/missing", method: "GET", max_length: 10000 },
        {} as any,
      );

      expect(result.type).toBe("error");
      expect(result.error).toContain("404");
    });

    it("returns error on fetch failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await webFetch.execute(
        { url: "https://example.com", method: "GET", max_length: 10000 },
        {} as any,
      );

      expect(result.type).toBe("error");
      expect(result.error).toContain("Network error");
    });
  });

  describe("webSearch", () => {
    it("has correct tool metadata", () => {
      expect(webSearch.name).toBe("web_search");
      expect(webSearch.permission.scope).toBe("network");
      expect(webSearch.permission.requiresApproval).toBe(true);
    });

    it("searches using custom API when SEARCH_API_URL is set", async () => {
      const originalEnv = process.env.SEARCH_API_URL;
      process.env.SEARCH_API_URL = "https://search.local/api";

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { title: "Result 1", url: "https://example.com/1", snippet: "First result" },
              { title: "Result 2", url: "https://example.com/2", snippet: "Second result" },
            ],
          }),
      });

      const result = await webSearch.execute(
        { query: "test query", max_results: 5 },
        {} as any,
      );

      expect(result.type).toBe("success");
      expect(result.content).toContain("Result 1");
      expect(result.content).toContain("Result 2");
      expect(result.metadata?.source).toBe("custom_api");

      process.env.SEARCH_API_URL = originalEnv;
    });

    it("falls back to DuckDuckGo when no custom API", async () => {
      delete process.env.SEARCH_API_URL;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("<html><body>No results matching pattern</body></html>"),
      });

      const result = await webSearch.execute(
        { query: "test query", max_results: 5 },
        {} as any,
      );

      expect(result.type).toBe("success");
      expect(result.metadata?.source).toBe("duckduckgo");
    });

    it("returns error when search fails", async () => {
      delete process.env.SEARCH_API_URL;
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const result = await webSearch.execute(
        { query: "test", max_results: 5 },
        {} as any,
      );

      expect(result.type).toBe("error");
      expect(result.error).toContain("Connection refused");
    });
  });
});
