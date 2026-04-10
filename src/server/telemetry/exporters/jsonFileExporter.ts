/**
 * JSON file exporter for telemetry data.
 *
 * Writes spans and metrics to timestamped JSON files on disk.
 * Suitable for local-first telemetry persistence and offline analysis.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ExportedSpan {
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, string | number | boolean>;
  status: "ok" | "error" | "unset";
  events: Array<{ name: string; timestamp: number }>;
}

export interface ExportedMetric {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

/**
 * Exports telemetry data to JSON files on the local filesystem.
 */
export class JsonFileExporter {
  private readonly outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir =
      outputDir ?? path.join(os.homedir(), ".agentic-workforce", "telemetry");
  }

  /**
   * Export spans to a JSON file.
   * @returns The absolute path of the written file.
   */
  exportSpans(spans: ExportedSpan[], filename?: string): string {
    this.ensureDir();
    const name = filename ?? `spans-${this.timestamp()}.json`;
    const filePath = path.join(this.outputDir, name);
    fs.writeFileSync(filePath, JSON.stringify(spans, null, 2), "utf-8");
    return filePath;
  }

  /**
   * Export metrics to a JSON file.
   * @returns The absolute path of the written file.
   */
  exportMetrics(metrics: ExportedMetric[], filename?: string): string {
    this.ensureDir();
    const name = filename ?? `metrics-${this.timestamp()}.json`;
    const filePath = path.join(this.outputDir, name);
    fs.writeFileSync(filePath, JSON.stringify(metrics, null, 2), "utf-8");
    return filePath;
  }

  /**
   * Export a combined snapshot of spans and metrics.
   * @returns The absolute path of the written file.
   */
  exportSnapshot(spans: ExportedSpan[], metrics: ExportedMetric[]): string {
    this.ensureDir();
    const name = `snapshot-${this.timestamp()}.json`;
    const filePath = path.join(this.outputDir, name);
    const snapshot = {
      exportedAt: new Date().toISOString(),
      spans,
      metrics,
    };
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
    return filePath;
  }

  /**
   * Remove old export files, keeping only the most recent `maxFiles`.
   * @returns The number of files deleted.
   */
  cleanup(maxFiles: number = 50): number {
    if (!fs.existsSync(this.outputDir)) return 0;

    const entries = fs
      .readdirSync(this.outputDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(this.outputDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    if (entries.length <= maxFiles) return 0;

    const toDelete = entries.slice(maxFiles);
    for (const entry of toDelete) {
      fs.unlinkSync(path.join(this.outputDir, entry.name));
    }
    return toDelete.length;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  private timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }
}
