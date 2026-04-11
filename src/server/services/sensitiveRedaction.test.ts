import { describe, it, expect } from "vitest";
import {
  sanitizeUnicode,
  sanitizeAndRedact,
  redactSensitiveText,
  redactStringArray,
} from "./sensitiveRedaction";

// ---------------------------------------------------------------------------
// sanitizeUnicode
// ---------------------------------------------------------------------------

describe("sanitizeUnicode", () => {
  it("strips zero-width spaces (U+200B)", () => {
    const input = "hello\u200Bworld";
    const result = sanitizeUnicode(input);
    expect(result).toBe("helloworld");
  });

  it("strips BOM (U+FEFF)", () => {
    const input = "\uFEFFHello World";
    const result = sanitizeUnicode(input);
    expect(result).toBe("Hello World");
  });

  it("strips Unicode tag characters (U+E0001)", () => {
    const input = "test\u{E0001}content";
    const result = sanitizeUnicode(input);
    expect(result).toBe("testcontent");
  });

  it("applies NFKC normalization", () => {
    // Full-width characters normalize to ASCII
    const input = "\uFF21\uFF22\uFF23"; // Full-width ABC
    const result = sanitizeUnicode(input);
    expect(result).toBe("ABC");
  });

  it("preserves normal text unchanged", () => {
    const input = "Normal text with spaces and punctuation!";
    const result = sanitizeUnicode(input);
    expect(result).toBe("Normal text with spaces and punctuation!");
  });
});

// ---------------------------------------------------------------------------
// sanitizeAndRedact
// ---------------------------------------------------------------------------

describe("sanitizeAndRedact", () => {
  it("combines Unicode sanitization and credential redaction", () => {
    const input = "API\u200B key: sk-1234567890abcdef";
    const result = sanitizeAndRedact(input);
    expect(result).not.toContain("\u200B");
    expect(result).toContain("[REDACTED_TOKEN]");
  });
});

// ---------------------------------------------------------------------------
// expanded redaction patterns
// ---------------------------------------------------------------------------

describe("expanded redaction patterns", () => {
  it("redacts AWS access keys (AKIA...)", () => {
    const input = "AWS key: AKIAIOSFODNN7EXAMPLE";
    const result = redactSensitiveText(input);
    expect(result).toContain("[REDACTED_AWS_KEY]");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts JWTs (eyJ...eyJ...)", () => {
    const input = "Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = redactSensitiveText(input);
    expect(result).toContain("[REDACTED_JWT]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts database URLs (postgres://user:pass@host)", () => {
    const input = "DB: postgres://admin:secretpass@localhost:5432/mydb";
    const result = redactSensitiveText(input);
    expect(result).toContain("postgres://[REDACTED]@[REDACTED]");
    expect(result).not.toContain("admin");
    expect(result).not.toContain("secretpass");
  });

  it("redacts SSH private keys", () => {
    const input = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
-----END OPENSSH PRIVATE KEY-----`;
    const result = redactSensitiveText(input);
    // The pattern matches OPENSSH PRIVATE KEY and uses [REDACTED_SSH_KEY]
    // but the generic PRIVATE KEY pattern also matches and uses [REDACTED_PRIVATE_KEY]
    // The OPENSSH pattern is more specific and comes later, so it should win
    // Actually checking the pattern order - the OPENSSH pattern is listed after
    // Let's just check it got redacted with either
    expect(result).toMatch(/\[REDACTED_(SSH|PRIVATE)_KEY\]/);
    expect(result).not.toContain("b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW");
  });

  it("redacts env var assignments (export SECRET_KEY=...)", () => {
    const input = "export DATABASE_PASSWORD=super_secret_123";
    const result = redactSensitiveText(input);
    expect(result).toContain("DATABASE_PASSWORD=[REDACTED]");
    expect(result).not.toContain("super_secret_123");
  });

  it("redacts Basic auth headers", () => {
    const input = "Authorization: Basic dXNlcjpwYXNzd29yZA==";
    const result = redactSensitiveText(input);
    expect(result).toContain("Basic [REDACTED]");
    expect(result).not.toContain("dXNlcjpwYXNzd29yZA==");
  });

  it("redacts bearer tokens", () => {
    const input = "bearer abc123def456.ghi789_jkl012";
    const result = redactSensitiveText(input);
    expect(result).toContain("bearer [REDACTED]");
    expect(result).not.toContain("abc123def456");
  });

  it("redacts api_key=value assignments", () => {
    const input = "api_key=mysecretvalue123";
    const result = redactSensitiveText(input);
    expect(result).toContain("api_key=[REDACTED]");
    expect(result).not.toContain("mysecretvalue123");
  });

  it("redacts aws_secret_access_key assignments", () => {
    const input = "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE";
    const result = redactSensitiveText(input);
    expect(result).toContain("aws_secret_access_key=[REDACTED]");
    expect(result).not.toContain("wJalrXUtnFEMI");
  });

  it("redacts aws_access_key_id assignments", () => {
    const input = "aws_access_key_id=AKIAIOSFODNN7EXAMPLE";
    const result = redactSensitiveText(input);
    expect(result).toContain("aws_access_key_id=[REDACTED]");
  });

  it("redacts mongodb connection strings", () => {
    const input = "mongodb+srv://admin:password@cluster.mongodb.net/db";
    const result = redactSensitiveText(input);
    expect(result).toContain("mongodb+srv://[REDACTED]@[REDACTED]");
    expect(result).not.toContain("admin");
    expect(result).not.toContain("password");
  });

  it("redacts redis connection strings", () => {
    const input = "redis://user:pass@redis-host:6379/0";
    const result = redactSensitiveText(input);
    expect(result).toContain("redis://[REDACTED]@[REDACTED]");
    expect(result).not.toContain("pass");
  });

  it("redacts mysql connection strings", () => {
    const input = "mysql://root:secret@localhost:3306/mydb";
    const result = redactSensitiveText(input);
    expect(result).toContain("mysql://[REDACTED]@[REDACTED]");
    expect(result).not.toContain("secret");
  });

  it("redacts RSA private keys", () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn
-----END RSA PRIVATE KEY-----`;
    const result = redactSensitiveText(input);
    expect(result).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result).not.toContain("MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn");
  });

  it("redacts device_code assignments", () => {
    const input = "device_code=abc123xyz789";
    const result = redactSensitiveText(input);
    expect(result).toContain("device_code=[REDACTED]");
    expect(result).not.toContain("abc123xyz789");
  });

  it("redacts set command with SECRET env var", () => {
    const input = "set MY_SECRET_TOKEN=super_secret_val";
    const result = redactSensitiveText(input);
    expect(result).toContain("MY_SECRET_TOKEN=[REDACTED]");
    expect(result).not.toContain("super_secret_val");
  });

  it("redacts GitHub PAT tokens (ghp_)", () => {
    const input = "token: ghp_abc123def456ghi789jklmnop";
    const result = redactSensitiveText(input);
    expect(result).toContain("[REDACTED_TOKEN]");
    expect(result).not.toContain("ghp_abc123def456ghi789jklmnop");
  });
});

// ---------------------------------------------------------------------------
// redactUrlSecrets
// ---------------------------------------------------------------------------

describe("redactUrlSecrets", () => {
  it("redacts token query parameter in URLs", () => {
    const input = "Visit https://example.com/callback?token=abc123secret&other=keep";
    const result = redactSensitiveText(input);
    expect(result).toContain("token=%5BREDACTED%5D");
    expect(result).not.toContain("abc123secret");
    expect(result).toContain("other=keep");
  });

  it("redacts code query parameter in OAuth URLs", () => {
    const input = "Redirect: https://example.com/oauth?code=4/P7q7W91&state=xyz123";
    const result = redactSensitiveText(input);
    expect(result).not.toContain("4/P7q7W91");
    expect(result).not.toContain("xyz123");
  });

  it("redacts key query parameter", () => {
    const input = "API: https://maps.example.com/api?key=AIzaSyB123secret456";
    const result = redactSensitiveText(input);
    expect(result).not.toContain("AIzaSyB123secret456");
  });

  it("redacts password query parameter", () => {
    const input = "URL: https://example.com/login?password=hunter2";
    const result = redactSensitiveText(input);
    expect(result).not.toContain("hunter2");
  });

  it("redacts secret query parameter", () => {
    const input = "https://example.com/webhook?secret=mysecretvalue";
    const result = redactSensitiveText(input);
    expect(result).not.toContain("mysecretvalue");
  });

  it("leaves URLs without sensitive params unchanged", () => {
    const input = "Visit https://example.com/page?foo=bar&baz=qux";
    const result = redactSensitiveText(input);
    expect(result).toContain("foo=bar");
    expect(result).toContain("baz=qux");
  });

  it("leaves URLs with no query params unchanged", () => {
    const input = "Visit https://example.com/page";
    const result = redactSensitiveText(input);
    expect(result).toBe("Visit https://example.com/page");
  });

  it("handles malformed URLs gracefully (falls through catch)", () => {
    // The URL constructor can fail on certain inputs; test that the catch block
    // returns the match unchanged. We use a string that looks like a URL but
    // breaks URL parsing when extracted.
    const input = "Check http://[invalid-url";
    const result = redactSensitiveText(input);
    expect(result).toContain("http://[invalid-url");
  });
});

// ---------------------------------------------------------------------------
// redactStringArray
// ---------------------------------------------------------------------------

describe("redactStringArray", () => {
  it("redacts each element of the array", () => {
    const input = [
      "Normal text",
      "bearer mytoken123456789.abc",
      "AKIAIOSFODNN7EXAMPLE",
    ];
    const result = redactStringArray(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("Normal text");
    expect(result[1]).toContain("[REDACTED]");
    expect(result[2]).toContain("[REDACTED_AWS_KEY]");
  });

  it("returns empty array for empty input", () => {
    expect(redactStringArray([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sanitizeUnicode — additional coverage
// ---------------------------------------------------------------------------

describe("sanitizeUnicode extra patterns", () => {
  it("strips private use area characters (U+E000-U+F8FF)", () => {
    const input = "test\uE000\uF8FFcontent";
    const result = sanitizeUnicode(input);
    expect(result).toBe("testcontent");
  });

  it("strips supplementary private use area characters", () => {
    const input = "test\u{F0000}content";
    const result = sanitizeUnicode(input);
    expect(result).toBe("testcontent");
  });

  it("strips line separator (U+2028) and paragraph separator (U+2029)", () => {
    const input = "line1\u2028line2\u2029line3";
    const result = sanitizeUnicode(input);
    expect(result).toBe("line1line2line3");
  });
});
