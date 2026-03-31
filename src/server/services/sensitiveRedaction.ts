const URL_QUERY_SECRET_PATTERNS = ["token", "code", "state", "key", "secret", "password"];

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  // Auth headers
  [/\b(bearer\s+)[a-z0-9._\-+/=]+/gi, "$1[REDACTED]"],
  [/\b(Authorization:\s*Basic\s+)[A-Za-z0-9+/=]+/gi, "$1[REDACTED]"],

  // API keys / tokens
  [/\b(sk|rk|pk|xox[baprs]|gh[pousr]_[a-z0-9]+|AIza)[a-z0-9._\-]{8,}\b/gi, "[REDACTED_TOKEN]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],

  // JWTs (three base64url segments separated by dots)
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]"],

  // Key/secret/password assignments
  [/\b(api[_-]?key|secret|password|passwd)\b\s*[:=]\s*[^\s"']+/gi, "$1=[REDACTED]"],
  [/\b(export|set)\s+(\w*(?:SECRET|PASSWORD|KEY|TOKEN|CREDENTIAL)\w*)\s*=\s*[^\s"']+/gi, "$1 $2=[REDACTED]"],
  [/\b(aws_secret_access_key|aws_access_key_id)\s*=\s*[^\s"']+/gi, "$1=[REDACTED]"],

  // Database connection strings (postgres, mysql, mongodb, redis)
  [/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:]+:[^@]+@[^\s)'"]+/gi, "$1://[REDACTED]@[REDACTED]"],

  // Private keys (PEM format — RSA, EC, DSA, OpenSSH, generic)
  [/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g, "[REDACTED_SSH_KEY]"],

  // Device codes
  [/\bdevice[_-]?code\b\s*[:=]\s*[^\s"']+/gi, "device_code=[REDACTED]"],
];

function redactUrlSecrets(input: string) {
  return input.replace(/https?:\/\/[^\s)]+/gi, (match) => {
    try {
      const parsed = new URL(match);
      let changed = false;
      for (const key of [...parsed.searchParams.keys()]) {
        if (URL_QUERY_SECRET_PATTERNS.some((pattern) => key.toLowerCase().includes(pattern))) {
          parsed.searchParams.set(key, "[REDACTED]");
          changed = true;
        }
      }
      return changed ? parsed.toString() : match;
    } catch {
      return match;
    }
  });
}

/**
 * Sanitize hidden Unicode characters that could be used for prompt injection.
 * Strips zero-width characters, format controls, private use area, and
 * Unicode tag characters (U+E0000–U+E007F used in tag smuggling attacks).
 */
export function sanitizeUnicode(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, "")  // zero-width, line/paragraph sep, BOM
    .replace(/[\uE000-\uF8FF]/g, "")                       // private use area
    .replace(/[\u{E0000}-\u{E007F}]/gu, "")                // Unicode tags (tag smuggling)
    .replace(/[\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, ""); // supplementary private use
}

export function redactSensitiveText(input: string) {
  let redacted = redactUrlSecrets(input);
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/** Redact + sanitize: applies both credential redaction and Unicode sanitization. */
export function sanitizeAndRedact(input: string): string {
  return redactSensitiveText(sanitizeUnicode(input));
}

export function redactStringArray(values: string[]) {
  return values.map((value) => redactSensitiveText(value));
}
