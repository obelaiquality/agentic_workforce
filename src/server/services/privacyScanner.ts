const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /(password|passwd|secret)\s*[:=]\s*["']?[^\s"']{6,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

export interface PrivacyScanResult {
  safe: boolean;
  redacted: string;
  findings: string[];
}

export function scanAndRedactSensitiveText(input: string): PrivacyScanResult {
  let redacted = input;
  const findings = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(redacted)) {
      findings.add(pattern.source);
      redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
    }
  }

  return {
    safe: findings.size === 0,
    redacted,
    findings: Array.from(findings),
  };
}

