/**
 * ToolResultOptimizer — reduces context bloat from verbose tool outputs.
 *
 * Each optimizer leaves small outputs untouched and only truncates / filters
 * when the content exceeds a sensible threshold.
 */

const ERROR_PATTERN = /error|err!|fail|fatal/i;
const BUILD_DIAG_PATTERN = /error|warning|warn|err!/i;

/* ------------------------------------------------------------------ */
/*  optimizeShellOutput                                               */
/* ------------------------------------------------------------------ */

export function optimizeShellOutput(output: string, maxLines = 50): string {
  const lines = output.split('\n');
  if (lines.length <= 100) return output;

  const errorLines = lines.filter((l) => ERROR_PATTERN.test(l));
  const tail = lines.slice(-maxLines);

  const parts: string[] = [];
  if (errorLines.length > 0) {
    parts.push(errorLines.join('\n'));
    parts.push('---');
  }
  parts.push(tail.join('\n'));
  parts.push(`[truncated: showing last ${maxLines} of ${lines.length} lines]`);

  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/*  optimizeFileRead                                                  */
/* ------------------------------------------------------------------ */

export function optimizeFileRead(content: string, maxLines = 20): string {
  const lines = content.split('\n');
  if (lines.length <= 200) return content;

  const omitted = lines.length - maxLines * 2;
  const head = lines.slice(0, maxLines);
  const tail = lines.slice(-maxLines);

  return (
    head.join('\n') +
    `\n... [${omitted} lines omitted] ...\n` +
    tail.join('\n')
  );
}

/* ------------------------------------------------------------------ */
/*  optimizeSearchResults                                             */
/* ------------------------------------------------------------------ */

export function optimizeSearchResults(
  results: string,
  maxMatches = 10,
): string {
  const blocks = results.split('\n\n');
  if (blocks.length <= 20) return results;

  const kept = blocks.slice(0, maxMatches);
  const omitted = blocks.length - maxMatches;

  return kept.join('\n\n') + `\n... [${omitted} more matches omitted] ...\n`;
}

/* ------------------------------------------------------------------ */
/*  optimizeBuildOutput                                               */
/* ------------------------------------------------------------------ */

export function optimizeBuildOutput(output: string): string {
  const lines = output.split('\n');
  if (lines.length <= 50) return output;

  const diagnostics = lines.filter((l) => BUILD_DIAG_PATTERN.test(l));

  return (
    `[build output filtered: ${lines.length} total lines, ${diagnostics.length} errors/warnings]\n` +
    diagnostics.join('\n')
  );
}

/* ------------------------------------------------------------------ */
/*  shouldOffload                                                     */
/* ------------------------------------------------------------------ */

export function shouldOffload(content: string, threshold = 8000): boolean {
  return content.length > threshold;
}

/* ------------------------------------------------------------------ */
/*  optimizeToolOutput — dispatcher                                   */
/* ------------------------------------------------------------------ */

export function optimizeToolOutput(
  output: string,
  toolType: 'shell' | 'file_read' | 'search' | 'build',
): string {
  switch (toolType) {
    case 'shell':
      return optimizeShellOutput(output);
    case 'file_read':
      return optimizeFileRead(output);
    case 'search':
      return optimizeSearchResults(output);
    case 'build':
      return optimizeBuildOutput(output);
  }
}
