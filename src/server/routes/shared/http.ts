import crypto from "node:crypto";

export function isAllowedCorsOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    const isLocalHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return isLocalHost;
  } catch {
    return false;
  }
}

export function isAuthorizedLocalApiRequest(input: {
  url: string;
  apiToken: string;
  headerToken: string | string[] | undefined;
}) {
  if (input.url.startsWith("/health")) {
    return true;
  }
  const normalizedHeaderToken = Array.isArray(input.headerToken) ? input.headerToken[0] : input.headerToken;
  if (!normalizedHeaderToken || !input.apiToken) {
    return false;
  }
  const a = Buffer.from(normalizedHeaderToken);
  const b = Buffer.from(input.apiToken);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function buildStreamHeaders(originHeader?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  if (originHeader && isAllowedCorsOrigin(originHeader)) {
    headers["Access-Control-Allow-Origin"] = originHeader;
    headers.Vary = "Origin";
  }
  return headers;
}
