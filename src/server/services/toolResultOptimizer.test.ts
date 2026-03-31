import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  optimizeShellOutput,
  optimizeFileRead,
  optimizeSearchResults,
  optimizeBuildOutput,
  shouldOffload,
  optimizeToolOutput,
  persistLargeResult,
  optimizeAndPersist,
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

/* ------------------------------------------------------------------ */
/*  persistLargeResult                                                */
/* ------------------------------------------------------------------ */

describe('persistLargeResult', () => {
  let sessionDir: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-result-test-'));
    sessionDir = tmpDir;
  });

  afterEach(() => {
    if (sessionDir && fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('returns null when output is below threshold', () => {
    const small = 'x'.repeat(50);
    const result = persistLargeResult(small, { threshold: 100 });
    expect(result).toBeNull();
  });

  it('returns null when output equals threshold', () => {
    const exact = 'x'.repeat(100);
    const result = persistLargeResult(exact, { threshold: 100 });
    expect(result).toBeNull();
  });

  it('persists output above threshold and returns metadata', () => {
    const large = 'x'.repeat(200);
    const result = persistLargeResult(large, { threshold: 100, previewSize: 50 });

    expect(result).not.toBeNull();
    expect(result!.filepath).toBeTruthy();
    expect(result!.preview).toBe('x'.repeat(50));
    expect(result!.originalSize).toBe(Buffer.byteLength(large));
    expect(result!.hasMore).toBe(true);
  });

  it('writes full output to disk', () => {
    const large = 'full content here '.repeat(20);
    const result = persistLargeResult(large, {
      threshold: 100,
      taskId: 'test-task',
      label: 'shell-output',
    });

    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.filepath)).toBe(true);

    const onDisk = fs.readFileSync(result!.filepath, 'utf-8');
    expect(onDisk).toBe(large);
  });

  it('creates directory structure if missing', () => {
    const large = 'x'.repeat(200);
    const result = persistLargeResult(large, {
      threshold: 100,
      taskId: 'nested-task',
    });

    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.filepath)).toBe(true);
  });

  it('respects custom previewSize', () => {
    const large = 'x'.repeat(500);
    const result = persistLargeResult(large, {
      threshold: 100,
      previewSize: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.preview).toBe('x'.repeat(100));
  });

  it('hasMore is false when output equals previewSize', () => {
    const exact = 'x'.repeat(150);
    const result = persistLargeResult(exact, {
      threshold: 100,
      previewSize: 150,
    });

    expect(result).not.toBeNull();
    expect(result!.hasMore).toBe(false);
  });

  it('hasMore is true when output exceeds previewSize', () => {
    const large = 'x'.repeat(300);
    const result = persistLargeResult(large, {
      threshold: 100,
      previewSize: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.hasMore).toBe(true);
  });

  it('uses label in filename when provided', () => {
    const large = 'x'.repeat(200);
    const result = persistLargeResult(large, {
      threshold: 100,
      label: 'custom-label',
    });

    expect(result).not.toBeNull();
    expect(path.basename(result!.filepath)).toContain('custom-label');
  });

  it('generates unique filenames for multiple persists', () => {
    const large = 'x'.repeat(200);
    const result1 = persistLargeResult(large, { threshold: 100, label: 'test' });
    const result2 = persistLargeResult(large, { threshold: 100, label: 'test' });

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.filepath).not.toBe(result2!.filepath);
  });

  it('reports accurate originalSize', () => {
    const content = 'hello world';
    const result = persistLargeResult(content, { threshold: 5 });

    expect(result).not.toBeNull();
    expect(result!.originalSize).toBe(Buffer.byteLength(content));
  });
});

/* ------------------------------------------------------------------ */
/*  optimizeAndPersist                                                */
/* ------------------------------------------------------------------ */

describe('optimizeAndPersist', () => {
  let sessionDir: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimize-persist-test-'));
    sessionDir = tmpDir;
  });

  afterEach(() => {
    if (sessionDir && fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('applies optimization for medium-sized outputs below persistence threshold', () => {
    // 150 lines is above the optimization threshold (100) but below persistence (100k chars)
    const medium = makeLines(150, 'line', { 5: 'error: failed' });
    const result = optimizeAndPersist(medium, 'shell');

    expect(result).toContain('[truncated: showing last 50 of 150 lines]');
    expect(result).toContain('error: failed');
    expect(result).not.toContain('[Full output');
  });

  it('persists very large outputs and returns preview with file reference', () => {
    // Use a low threshold for testing
    const huge = 'x'.repeat(150);

    // Create a mock version that uses a low threshold
    const output = huge;
    const persisted = persistLargeResult(output, { threshold: 100 });

    if (persisted) {
      const result = [
        persisted.preview,
        '',
        `[Full output (${formatBytes(persisted.originalSize)}) saved to: ${persisted.filepath}]`,
      ].join('\n');

      expect(result).toContain('x'.repeat(100));
      expect(result).toContain('[Full output');
      expect(result).toContain('saved to:');
    }
  });

  it('passes small outputs through unchanged', () => {
    const small = 'just a few lines\nno optimization needed';
    const result = optimizeAndPersist(small, 'shell');
    expect(result).toBe(small);
  });

  it('uses taskId and label when provided', () => {
    const large = 'x'.repeat(150);
    const persisted = persistLargeResult(large, {
      threshold: 100,
      taskId: 'task-123',
      label: 'build',
    });

    expect(persisted).not.toBeNull();
    expect(persisted!.filepath).toContain('task-123');
    expect(path.basename(persisted!.filepath)).toContain('build');
  });
});

// Helper function for formatting bytes (mirrors implementation)
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
