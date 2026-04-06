import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  LearningEntry,
  LearningCategory,
  LearningSource,
  ConsolidatedPrinciple,
} from "../../shared/contracts";
import { tokenize, cosineSimilarity } from "./memoryService";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LEARNINGS_DIR = ".agentic-workforce/learnings";
const LEARNINGS_FILE = "learnings.json";
const PRINCIPLES_FILE = "principles.json";
const MAX_LEARNINGS = 200;
const MAX_PRINCIPLES = 50;
const MERGE_SIMILARITY_THRESHOLD = 0.55;
const STALE_DAYS = 60;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface LearningsStore {
  learnings: LearningEntry[];
  principles: ConsolidatedPrinciple[];
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function saveJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// LearningsService
// ---------------------------------------------------------------------------

export class LearningsService {
  private readonly basePath: string;

  constructor(worktreePath: string) {
    this.basePath = path.join(worktreePath, LEARNINGS_DIR);
  }

  // ---- Read ----

  getLearnings(filter?: {
    projectId?: string;
    category?: LearningCategory;
    minConfidence?: number;
  }): LearningEntry[] {
    let items = this.loadLearnings();
    if (filter?.projectId) items = items.filter((l) => l.projectId === filter.projectId);
    if (filter?.category) items = items.filter((l) => l.category === filter.category);
    if (filter?.minConfidence) items = items.filter((l) => l.confidence >= filter.minConfidence!);
    return items.sort((a, b) => b.confidence - a.confidence);
  }

  getLearning(id: string): LearningEntry | null {
    return this.loadLearnings().find((l) => l.id === id) || null;
  }

  getPrinciples(projectId?: string): ConsolidatedPrinciple[] {
    let items = this.loadPrinciples();
    if (projectId) items = items.filter((p) => p.projectId === projectId);
    return items.sort((a, b) => b.confidence - a.confidence);
  }

  // ---- Write ----

  recordLearning(input: {
    projectId: string;
    category: LearningCategory;
    summary: string;
    detail: string;
    source: LearningSource;
    relatedFiles?: string[];
    relatedTools?: string[];
    confidence?: number;
  }): LearningEntry {
    const learnings = this.loadLearnings();

    // Check for duplicate/similar entries — merge if close
    const summaryTokens = tokenize(input.summary);
    const existing = learnings.find((l) => {
      if (l.projectId !== input.projectId || l.category !== input.category) return false;
      return cosineSimilarity(summaryTokens, tokenize(l.summary)) >= MERGE_SIMILARITY_THRESHOLD;
    });

    if (existing) {
      existing.occurrences += 1;
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.lastSeenAt = new Date().toISOString();
      if (input.detail.length > existing.detail.length) {
        existing.detail = input.detail.slice(0, 500);
      }
      const files = new Set([...existing.relatedFiles, ...(input.relatedFiles || [])]);
      existing.relatedFiles = Array.from(files).slice(0, 20);
      const tools = new Set([...existing.relatedTools, ...(input.relatedTools || [])]);
      existing.relatedTools = Array.from(tools).slice(0, 10);
      this.saveLearnings(learnings);
      return existing;
    }

    const entry: LearningEntry = {
      id: `learn_${randomUUID().slice(0, 12)}`,
      projectId: input.projectId,
      category: input.category,
      summary: input.summary.slice(0, 200),
      detail: input.detail.slice(0, 500),
      source: input.source,
      confidence: input.confidence ?? 0.3,
      occurrences: 1,
      relatedFiles: (input.relatedFiles || []).slice(0, 20),
      relatedTools: (input.relatedTools || []).slice(0, 10),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    learnings.push(entry);

    // Evict lowest confidence if over limit
    if (learnings.length > MAX_LEARNINGS) {
      learnings.sort((a, b) => b.confidence - a.confidence);
      learnings.length = MAX_LEARNINGS;
    }

    this.saveLearnings(learnings);
    return entry;
  }

  recordAntipattern(input: {
    projectId: string;
    summary: string;
    detail: string;
    source: LearningSource;
    relatedFiles?: string[];
    relatedTools?: string[];
  }): LearningEntry {
    return this.recordLearning({ ...input, category: "antipattern" });
  }

  recordPattern(input: {
    projectId: string;
    summary: string;
    detail: string;
    source: LearningSource;
    relatedFiles?: string[];
    relatedTools?: string[];
  }): LearningEntry {
    return this.recordLearning({ ...input, category: "pattern" });
  }

  updateLearning(id: string, updates: Partial<Pick<LearningEntry, "summary" | "detail" | "category" | "confidence">>): LearningEntry | null {
    const learnings = this.loadLearnings();
    const entry = learnings.find((l) => l.id === id);
    if (!entry) return null;
    if (updates.summary !== undefined) entry.summary = updates.summary.slice(0, 200);
    if (updates.detail !== undefined) entry.detail = updates.detail.slice(0, 500);
    if (updates.category !== undefined) entry.category = updates.category;
    if (updates.confidence !== undefined) entry.confidence = Math.max(0, Math.min(1, updates.confidence));
    this.saveLearnings(learnings);
    return entry;
  }

  deleteLearning(id: string): boolean {
    const learnings = this.loadLearnings();
    const idx = learnings.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    learnings.splice(idx, 1);
    this.saveLearnings(learnings);
    return true;
  }

  // ---- Consolidation ----

  consolidate(projectId: string): ConsolidatedPrinciple[] {
    const learnings = this.getLearnings({ projectId, minConfidence: 0.5 });
    if (learnings.length < 3) return [];

    const principles = this.loadPrinciples();
    const newPrinciples: ConsolidatedPrinciple[] = [];

    // Group learnings by overlapping tool/file sets
    const groups = this.groupRelatedLearnings(learnings);

    for (const group of groups) {
      if (group.length < 2) continue;

      // Build principle from group
      const categories = new Set(group.map((l) => l.category));
      const isAntipattern = categories.has("antipattern") && !categories.has("pattern");

      const summaries = group.map((l) => l.summary);
      const principleText = isAntipattern
        ? `Avoid: ${summaries[0]}`
        : `Prefer: ${summaries[0]}`;

      const reasoning = group
        .map((l) => l.detail)
        .filter(Boolean)
        .slice(0, 3)
        .join("; ");

      // Check if principle already exists
      const principleTokens = tokenize(principleText);
      const existingPrinciple = principles.find(
        (p) => p.projectId === projectId && cosineSimilarity(principleTokens, tokenize(p.principle)) >= MERGE_SIMILARITY_THRESHOLD,
      );

      if (existingPrinciple) {
        existingPrinciple.confidence = Math.min(1, existingPrinciple.confidence + 0.05);
        const derivedSet = new Set([...existingPrinciple.derivedFrom, ...group.map((l) => l.id)]);
        existingPrinciple.derivedFrom = Array.from(derivedSet);
        continue;
      }

      const principle: ConsolidatedPrinciple = {
        id: `principle_${randomUUID().slice(0, 12)}`,
        projectId,
        principle: principleText.slice(0, 200),
        reasoning: reasoning.slice(0, 500),
        derivedFrom: group.map((l) => l.id),
        confidence: Math.min(...group.map((l) => l.confidence)),
        createdAt: new Date().toISOString(),
      };

      principles.push(principle);
      newPrinciples.push(principle);
    }

    // Cap principles
    if (principles.length > MAX_PRINCIPLES) {
      principles.sort((a, b) => b.confidence - a.confidence);
      principles.length = MAX_PRINCIPLES;
    }

    this.savePrinciples(principles);
    return newPrinciples;
  }

  // ---- Prompt injection ----

  formatForSystemPrompt(projectId: string, maxTokens = 2000): string {
    const principles = this.getPrinciples(projectId).slice(0, 15);
    if (principles.length === 0) return "";

    const lines = ["## Project Learnings", ""];
    let estimatedTokens = 10;

    for (const p of principles) {
      const line = `- ${p.principle}`;
      const lineTokens = Math.ceil(line.length / 4);
      if (estimatedTokens + lineTokens > maxTokens) break;
      lines.push(line);
      estimatedTokens += lineTokens;
    }

    return lines.join("\n");
  }

  // ---- Pruning ----

  pruneStale(projectId: string): number {
    const learnings = this.loadLearnings();
    const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
    const before = learnings.length;
    const filtered = learnings.filter(
      (l) => l.projectId !== projectId || new Date(l.lastSeenAt).getTime() > cutoff || l.confidence >= 0.7,
    );
    this.saveLearnings(filtered);
    return before - filtered.length;
  }

  // ---- Stats ----

  getStats(projectId?: string): { learningsCount: number; principlesCount: number } {
    const learnings = projectId ? this.getLearnings({ projectId }) : this.loadLearnings();
    const principles = projectId ? this.getPrinciples(projectId) : this.loadPrinciples();
    return { learningsCount: learnings.length, principlesCount: principles.length };
  }

  // ---- Private helpers ----

  private groupRelatedLearnings(learnings: LearningEntry[]): LearningEntry[][] {
    const used = new Set<string>();
    const groups: LearningEntry[][] = [];

    for (const learning of learnings) {
      if (used.has(learning.id)) continue;

      const group = [learning];
      used.add(learning.id);
      const learningTokens = tokenize(learning.summary + " " + learning.detail);

      for (const candidate of learnings) {
        if (used.has(candidate.id)) continue;
        const candidateTokens = tokenize(candidate.summary + " " + candidate.detail);
        const toolOverlap = learning.relatedTools.some((t) => candidate.relatedTools.includes(t));

        if (cosineSimilarity(learningTokens, candidateTokens) >= 0.3 || toolOverlap) {
          group.push(candidate);
          used.add(candidate.id);
        }
      }

      groups.push(group);
    }

    return groups.filter((g) => g.length >= 2);
  }

  private loadLearnings(): LearningEntry[] {
    return loadJson<LearningEntry[]>(path.join(this.basePath, LEARNINGS_FILE), []);
  }

  private saveLearnings(learnings: LearningEntry[]): void {
    saveJson(path.join(this.basePath, LEARNINGS_FILE), learnings);
  }

  private loadPrinciples(): ConsolidatedPrinciple[] {
    return loadJson<ConsolidatedPrinciple[]>(path.join(this.basePath, PRINCIPLES_FILE), []);
  }

  private savePrinciples(principles: ConsolidatedPrinciple[]): void {
    saveJson(path.join(this.basePath, PRINCIPLES_FILE), principles);
  }
}
