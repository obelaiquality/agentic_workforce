const URL_QUERY_SECRET_PATTERNS = ["token", "code", "state", "key", "secret", "password"];

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(bearer\s+)[a-z0-9._\-+/=]+/gi, "$1[REDACTED]"],
  [/\b(sk|rk|pk|xox[baprs]|gh[pousr]_[a-z0-9]+|AIza)[a-z0-9._\-]{8,}\b/gi, "[REDACTED_TOKEN]"],
  [/\b(api[_-]?key|secret|password|passwd)\b\s*[:=]\s*[^\s"']+/gi, "$1=[REDACTED]"],
  [/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
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

export function redactSensitiveText(input: string) {
  let redacted = redactUrlSecrets(input);
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactStringArray(values: string[]) {
  return values.map((value) => redactSensitiveText(value));
}
