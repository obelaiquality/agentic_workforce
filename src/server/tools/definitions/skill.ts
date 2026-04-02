import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../types";
import { SkillService } from "../../skills/skillService";

// Singleton skill service instance
let _skillService: SkillService | null = null;

export function getSkillService(): SkillService {
  if (!_skillService) {
    _skillService = new SkillService();
  }
  return _skillService;
}

export function setSkillService(service: SkillService): void {
  _skillService = service;
}

const skillSchema = z.object({
  skill: z.string().describe("Skill name or ID to invoke (e.g., 'commit', 'verify', 'debug')"),
  args: z.string().optional().describe("Optional arguments to pass to the skill"),
});

export const skillTool: ToolDefinition<z.infer<typeof skillSchema>> = {
  name: "skill",
  description: `Invoke a named skill (reusable prompt package) to accomplish a specific task.

Available built-in skills:
- commit: Review staged changes and create a commit with a descriptive message
- verify: Run verification commands (tests, lint, build) and report results
- simplify: Review changed code for quality, efficiency, and reuse opportunities
- debug: Diagnose and fix a failing test or runtime error
- plan: Build a structured implementation plan (read-only exploration)

Use tool_search to discover additional skills, or ask the user what custom skills are available.`,

  inputSchema: skillSchema,

  permission: {
    scope: "meta",
    readOnly: false,
  },

  alwaysLoad: true,
  concurrencySafe: true,
  searchHints: ["invoke", "workflow", "template", "recipe", "skill", "commit", "verify", "debug"],

  async execute(input, ctx) {
    const service = getSkillService();
    const skill = service.getSkill(input.skill);

    if (!skill) {
      // List available skills to help the agent
      const available = service.listSkills();
      const names = available.map(s => `  - ${s.name}: ${s.description}`).join("\n");
      return {
        type: "error",
        error: `Skill "${input.skill}" not found. Available skills:\n${names}`,
      };
    }

    // Start invocation tracking
    const invocation = await service.startInvocation({
      skillId: skill.id,
      args: input.args,
      projectId: ctx.repoId,
      ticketId: ctx.ticketId,
      runId: ctx.runId,
    });

    // Record skill invocation event
    await ctx.recordEvent({
      type: "skill_invoked",
      payload: {
        skillId: skill.id,
        skillName: skill.name,
        invocationId: invocation.id,
        contextMode: skill.contextMode,
        args: input.args,
      },
    });

    try {
      if (skill.contextMode === "inline") {
        // For inline skills: return the skill prompt as instruction for the agent
        // The agent will execute the skill instructions in its current context
        const prompt = service.buildSkillPrompt(skill, input.args);

        await service.completeInvocation(invocation.id, "Skill instructions injected into context");

        await ctx.recordEvent({
          type: "skill_completed",
          payload: { invocationId: invocation.id, output: "Instructions injected" },
        });

        return {
          type: "success",
          content: `[Skill: ${skill.name}]\n\nFollow these instructions to complete the skill:\n\n${prompt}\n\n---\nAllowed tools for this skill: ${skill.allowedTools.length ? skill.allowedTools.join(", ") : "all tools"}`,
          metadata: {
            invocationId: invocation.id,
            skillId: skill.id,
            skillName: skill.name,
            contextMode: "inline",
            allowedTools: skill.allowedTools,
            maxIterations: skill.maxIterations,
          },
        };
      } else {
        // For fork skills: return instructions noting this should be delegated
        // Full fork execution requires AgenticOrchestrator integration (future)
        const prompt = service.buildSkillPrompt(skill, input.args);

        await service.completeInvocation(invocation.id, "Fork skill prepared");

        await ctx.recordEvent({
          type: "skill_completed",
          payload: { invocationId: invocation.id, output: "Fork skill prepared" },
        });

        return {
          type: "success",
          content: `[Skill: ${skill.name} (fork mode)]\n\nThis skill should be executed as a separate agent. Instructions:\n\n${prompt}\n\n---\nAllowed tools: ${skill.allowedTools.length ? skill.allowedTools.join(", ") : "all tools"}\nMax iterations: ${skill.maxIterations || "default"}`,
          metadata: {
            invocationId: invocation.id,
            skillId: skill.id,
            skillName: skill.name,
            contextMode: "fork",
            allowedTools: skill.allowedTools,
            maxIterations: skill.maxIterations,
          },
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await service.failInvocation(invocation.id, message);

      await ctx.recordEvent({
        type: "skill_failed",
        payload: { invocationId: invocation.id, error: message },
      });

      return {
        type: "error",
        error: `Skill "${skill.name}" failed: ${message}`,
      };
    }
  },
};
