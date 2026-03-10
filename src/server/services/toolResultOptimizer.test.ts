import { describe, it, expect } from 'vitest';
import {
  optimizeShellOutput,
  optimizeFileRead,
  optimizeSearchResults,
  optimizeBuildOutput,
  shouldOffload,
  optimizeToolOutput,
} from './toolResultOptimizer';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Generate N lines of filler text, optionally injecting special lines. */
function makeLines(
  n: number,
  prefix = 'line',
  injections?: Record<number, string>,
): string {
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) {
    lines.push(injections?.[i] ?? `${prefix} ${i}`);
  }
  return lines.join('\n');
}

/** Generate N double-newline-separated match blocks. */
function makeMatchBlocks(n: number): string {
  return Array.from({ length: n }, (_, i) => `file${i + 1}.ts:10: match ${i + 1}`).join('\n\n');
}

/* ------------------------------------------------------------------ */
/*  optimizeShellOutput                                               */
/* ------------------------------------------------------------------ */

describe('optimizeShellOutput', () => {
  it('passes through small output unchanged', () => {
    const small = makeLines(80);
    expect(optimizeShellOutput(small)).toBe(small);
  });

  it('passes through exactly 100 lines unchanged', () => {
    const exact = makeLines(100);
    expect(optimizeShellOutput(exact)).toBe(exact);
  });

  it('truncates large output and keeps last N lines', () => {
    const large = makeLines(350);
    const result = optimizeShellOutput(large);
    expect(result).toContain('[truncated: showing last 50 of 350 lines]');
    expect(result).toContain('line 350');
    expect(result).toContain('line 301');
    expect(result).not.toContain('\nline 200\n');
  });

  it('extracts error lines from large output', () => {
    const large = makeLines(200, 'line', {
      5: 'error: something broke',
      42: 'FAIL test suite xyz',
      150: 'fatal: cannot proceed',
    });
    const result = optimizeShellOutput(large);
    expect(result).toContain('error: something broke');
    expect(result).toContain('FAIL test suite xyz');
    expect(result).toContain('fatal: cannot proceed');
    expect(result).toContain('---');
    expect(result).toContain('[truncated: showing last 50 of 200 lines]');
  });

  it('respects custom maxLines', () => {
    const large = makeLines(200);
    const result = optimizeShellOutput(large, 10);
    expect(result).toContain('[truncated: showing last 10 of 200 lines]');
    expect(result).toContain('line 200');
    expect(result).toContain('line 191');
  });

  it('omits error section when there are no errors', () => {
    const large = makeLines(150, 'info');
    const result = optimizeShellOutput(large);
    expect(result).not.toContain('---');
  });
});

/* ------------------------------------------------------------------ */
/*  optimizeFileRead                                                  */
/* ------------------------------------------------------------------ */

describe('optimizeFileRead', () => {
  it('passes through small content unchanged', () => {
    const small = makeLines(100);
    expect(optimizeFileRead(small)).toBe(small);
  });

  it('passes through exactly 200 lines unchanged', () => {
    const exact = makeLines(200);
    expect(optimizeFileRead(exact)).toBe(exact);
  });

  it('shows first and last lines with omission notice for large files', () => {
    const large = makeLines(500);
    const result = optimizeFileRead(large);
    // Head
    expect(result).toContain('line 1');
    expect(result).toContain('line 20');
    // Tail
    expect(result).toContain('line 481');
    expect(result).toContain('line 500');
    // Omission notice: 500 - 20*2 = 460
    expect(result).toContain('... [460 lines omitted] ...');
    // Middle lines should not appear
    expect(result).not.toContain('\nline 250\n');
  });

  it('respects custom maxLines', () => {
    const large = makeLines(300);
    const result = optimizeFileRead(large, 5);
    expect(result).toContain('line 1');
    expect(result).toContain('line 5');
    expect(result).toContain('line 296');
    expect(result).toContain('line 300');
    // 300 - 5*2 = 290
    expect(result).toContain('... [290 lines omitted] ...');
  });
});

/* ------------------------------------------------------------------ */
/*  optimizeSearchResults                                             */
/* ------------------------------------------------------------------ */

describe('optimizeSearchResults', () => {
  it('passes through small result sets unchanged', () => {
    const small = makeMatchBlocks(15);
    expect(optimizeSearchResults(small)).toBe(small);
  });

  it('passes through exactly 20 blocks unchanged', () => {
    const exact = makeMatchBlocks(20);
    expect(optimizeSearchResults(exact)).toBe(exact);
  });

  it('limits match count for large result sets', () => {
    const large = makeMatchBlocks(50);
    const result = optimizeSearchResults(large);
    expect(result).toContain('file1.ts:10: match 1');
    expect(result).toContain('file10.ts:10: match 10');
    expect(result).toContain('... [40 more matches omitted] ...');
    expect(result).not.toContain('file11.ts');
  });

  it('respects custom maxMatches', () => {
    const large = makeMatchBlocks(30);
    const result = optimizeSearchResults(large, 5);
    expect(result).toContain('file5.ts:10: match 5');
    expect(result).toContain('... [25 more matches omitted] ...');
    expect(result).not.toContain('file6.ts');
  });
});

/* ------------------------------------------------------------------ */
/*  optimizeBuildOutput                                               */
/* ------------------------------------------------------------------ */

describe('optimizeBuildOutput', () => {
  it('passes through small build output unchanged', () => {
    const small = makeLines(30, 'compiling');
    expect(optimizeBuildOutput(small)).toBe(small);
  });

  it('passes through exactly 50 lines unchanged', () => {
    const exact = makeLines(50);
    expect(optimizeBuildOutput(exact)).toBe(exact);
  });

  it('extracts error and warning lines from large build output', () => {
    const large = makeLines(200, 'compiling', {
      10: 'src/foo.ts(5,3): error TS2322: Type mismatch',
      55: 'src/bar.ts(12,1): warning TS6133: unused variable',
      120: 'ERR! Build failed',
      180: 'WARN deprecated package xyz',
    });
    const result = optimizeBuildOutput(large);
    expect(result).toContain('[build output filtered: 200 total lines, 4 errors/warnings]');
    expect(result).toContain('error TS2322');
    expect(result).toContain('warning TS6133');
    expect(result).toContain('ERR! Build failed');
    expect(result).toContain('WARN deprecated package xyz');
    // Normal lines should be filtered out
    expect(result).not.toContain('compiling 50');
  });

  it('handles build output with zero diagnostics', () => {
    const large = makeLines(100, 'compiling');
    const result = optimizeBuildOutput(large);
    expect(result).toContain('[build output filtered: 100 total lines, 0 errors/warnings]');
  });
});

/* ------------------------------------------------------------------ */
/*  shouldOffload                                                     */
/* ------------------------------------------------------------------ */

describe('shouldOffload', () => {
  it('returns false for small content', () => {
    expect(shouldOffload('hello world')).toBe(false);
  });

  it('returns false at exactly the threshold', () => {
    const exact = 'x'.repeat(8000);
    expect(shouldOffload(exact)).toBe(false);
  });

  it('returns true above the default threshold', () => {
    const large = 'x'.repeat(8001);
    expect(shouldOffload(large)).toBe(true);
  });

  it('respects custom threshold', () => {
    expect(shouldOffload('hello', 4)).toBe(true);
    expect(shouldOffload('hi', 4)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  optimizeToolOutput — dispatcher                                   */
/* ------------------------------------------------------------------ */

describe('optimizeToolOutput', () => {
  it('dispatches to optimizeShellOutput for "shell"', () => {
    const large = makeLines(200, 'cmd', { 5: 'error: boom' });
    const result = optimizeToolOutput(large, 'shell');
    expect(result).toContain('[truncated: showing last 50 of 200 lines]');
    expect(result).toContain('error: boom');
  });

  it('dispatches to optimizeFileRead for "file_read"', () => {
    const large = makeLines(300);
    const result = optimizeToolOutput(large, 'file_read');
    expect(result).toContain('lines omitted');
  });

  it('dispatches to optimizeSearchResults for "search"', () => {
    const large = makeMatchBlocks(30);
    const result = optimizeToolOutput(large, 'search');
    expect(result).toContain('more matches omitted');
  });

  it('dispatches to optimizeBuildOutput for "build"', () => {
    const large = makeLines(100, 'compiling', { 10: 'error: nope' });
    const result = optimizeToolOutput(large, 'build');
    expect(result).toContain('build output filtered');
    expect(result).toContain('error: nope');
  });

  it('passes small inputs through unchanged regardless of type', () => {
    const small = 'just a few lines\nnothing big';
    expect(optimizeToolOutput(small, 'shell')).toBe(small);
    expect(optimizeToolOutput(small, 'file_read')).toBe(small);
    expect(optimizeToolOutput(small, 'search')).toBe(small);
    expect(optimizeToolOutput(small, 'build')).toBe(small);
  });
});
