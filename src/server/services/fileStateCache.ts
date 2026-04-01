/**
 * FileStateCache — LRU cache for file contents with size-based eviction.
 *
 * Inspired by claude-code's FileStateCache pattern. Avoids redundant disk reads
 * during execution steps where the same files are read multiple times (context
 * building, edit matching, verification).
 *
 * Thread-safe for single-process Node.js. Entries are invalidated on write.
 */

import { normalize } from "node:path";

export interface FileState {
  content: string;
  timestamp: number;
  /** Byte length of content, cached to avoid recomputation. */
  sizeBytes: number;
  /** When the agent last read this file (for staleness detection). */
  lastReadAt?: number;
}

export interface FileStateCacheOptions {
  /** Maximum number of entries (default 100). */
  maxEntries?: number;
  /** Maximum total size in bytes (default 25MB). */
  maxSizeBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * LRU cache with both entry-count and size-based eviction.
 * Keys are normalized file paths.
 */
export class FileStateCache {
  private cache = new Map<string, FileState>();
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number;
  private currentSizeBytes = 0;

  constructor(options?: FileStateCacheOptions) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  }

  private normalizeKey(filePath: string): string {
    return normalize(filePath);
  }

  get(filePath: string): FileState | undefined {
    const key = this.normalizeKey(filePath);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // LRU: move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(filePath: string, content: string, timestamp?: number): void {
    const key = this.normalizeKey(filePath);
    const sizeBytes = Buffer.byteLength(content);

    // Capture lastReadAt before removing existing entry
    const existingLastReadAt = this.cache.get(key)?.lastReadAt;

    // Remove existing entry first (updates size accounting)
    if (this.cache.has(key)) {
      this.delete(filePath);
    }

    // Evict until we have room
    while (
      (this.cache.size >= this.maxEntries ||
        this.currentSizeBytes + sizeBytes > this.maxSizeBytes) &&
      this.cache.size > 0
    ) {
      this.evictOldest();
    }

    // Don't cache files larger than the entire budget
    if (sizeBytes > this.maxSizeBytes) return;

    const entry: FileState = {
      content,
      timestamp: timestamp ?? Date.now(),
      sizeBytes,
      lastReadAt: existingLastReadAt,
    };
    this.cache.set(key, entry);
    this.currentSizeBytes += sizeBytes;
  }

  has(filePath: string): boolean {
    return this.cache.has(this.normalizeKey(filePath));
  }

  /** Invalidate a cache entry (e.g., after writing to the file). */
  delete(filePath: string): boolean {
    const key = this.normalizeKey(filePath);
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.currentSizeBytes -= entry.sizeBytes;
    return this.cache.delete(key);
  }

  /** Invalidate all entries. */
  clear(): void {
    this.cache.clear();
    this.currentSizeBytes = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get totalSizeBytes(): number {
    return this.currentSizeBytes;
  }

  /** Get all cached file paths. */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /** Record that the agent read this file at the current time. */
  recordRead(filePath: string): void {
    const key = this.normalizeKey(filePath);
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastReadAt = Date.now();
      // LRU: move to end
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
    // If not cached, do nothing — the file will be cached on next set()
  }

  /** Get the timestamp of the last agent read, or undefined. */
  getLastReadTimestamp(filePath: string): number | undefined {
    return this.cache.get(this.normalizeKey(filePath))?.lastReadAt;
  }

  /**
   * Check if the file has been externally modified since the agent last read it.
   * Uses content comparison as fallback for cloud sync / antivirus false positives
   * (file mtime changes but content is identical).
   */
  isStaleSinceRead(
    filePath: string,
    currentMtimeMs: number,
    currentContent?: string,
  ): boolean {
    const key = this.normalizeKey(filePath);
    const entry = this.cache.get(key);
    const lastRead = entry?.lastReadAt;
    if (lastRead === undefined) return false; // Never read → not stale
    if (currentMtimeMs <= lastRead) return false; // Not modified since read
    // Content fallback: mtime differs but content may be identical (cloud sync, AV)
    if (currentContent !== undefined && entry) {
      if (entry.content === currentContent) return false;
    }
    return true;
  }

  private evictOldest(): void {
    // Map iterator yields in insertion order — first entry is the oldest (LRU)
    const oldest = this.cache.keys().next();
    if (!oldest.done) {
      const entry = this.cache.get(oldest.value);
      if (entry) {
        this.currentSizeBytes -= entry.sizeBytes;
      }
      this.cache.delete(oldest.value);
    }
  }
}

/** Shared singleton for use across services within a task execution. */
let sharedCache: FileStateCache | null = null;

export function getSharedFileStateCache(): FileStateCache {
  if (!sharedCache) {
    sharedCache = new FileStateCache();
  }
  return sharedCache;
}

export function resetSharedFileStateCache(): void {
  sharedCache?.clear();
  sharedCache = null;
}
