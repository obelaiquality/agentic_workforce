import type { SkillRecord, SkillContextMode } from "../../shared/contracts";

export interface SkillDefinitionFile {
  name: string;
  description: string;
  version: string;
  contextMode: SkillContextMode;
  allowedTools: string[] | "*";
  maxIterations?: number;
  systemPrompt: string;
  referenceFiles: Array<{ path: string; purpose: string }>;
  hooks?: { preExecution?: string; postExecution?: string };
  author: string;
  tags: string[];
}

export interface SkillInvocationInput {
  skillId: string;
  args?: string;
  projectId: string;
  ticketId?: string;
  runId?: string;
}

export interface SkillInvocationResult {
  invocationId: string;
  status: "running" | "completed" | "failed";
  output: string;
  childRunId?: string;
}
