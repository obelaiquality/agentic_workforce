export function truncateFileContent(text: string, lineLimit = 800, byteLimit = 64000) {
  const lines = text.split("\n");
  const truncated = Buffer.byteLength(text, "utf8") > byteLimit || lines.length > lineLimit;
  const content = truncated ? lines.slice(0, lineLimit).join("\n").slice(0, byteLimit) : text;
  return { content, truncated };
}
