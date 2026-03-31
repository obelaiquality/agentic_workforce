import { describe, it, expect } from "vitest";
import {
  sanitizeUnicode,
  sanitizeAndRedact,
  redactSensitiveText,
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
});
