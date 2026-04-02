# Hook System

User-configurable hooks for intercepting and reacting to system events.

## Architecture

### Types (`types.ts`)
- `HookExecutionInput` - Input parameters for hook execution
- `HookExecutionOutput` - Result of hook execution with decision overrides

### Service (`hookService.ts`)
- In-memory hook storage with CRUD operations
- Three execution modes:
  - **Command**: Executes shell command with JSON stdin/stdout
  - **Prompt**: Uses LLM to evaluate (placeholder)
  - **Agent**: Spawns full agent run (placeholder)
- Execution logging for audit trail
- Test mode for dry-run validation

## Hook Types

### Command Hooks
Execute external commands with JSON payload on stdin. Command should output JSON:

```json
{
  "continue": true,
  "systemMessage": "Optional message to inject into conversation",
  "permissionDecision": "allow|deny|approval_required",
  "updatedInput": { "modified": "params" }
}
```

Example command hook script:
```bash
#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

if (input.tool_name === 'bash' && input.params.command.includes('rm -rf')) {
  console.log(JSON.stringify({
    continue: false,
    permissionDecision: 'deny',
    systemMessage: 'Dangerous command blocked by hook'
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
```

### Prompt Hooks (Placeholder)
Use LLM to evaluate the event. Template supports:
- `{{tool_name}}` - Name of tool being invoked
- `{{params}}` - JSON-stringified parameters

Currently returns a formatted message. Future: will call `providerOrchestrator`.

### Agent Hooks (Placeholder)
Spawn a full agent run with `agentObjective`. Currently returns a message. Future: will integrate with `AgenticOrchestrator`.

## Event Types

- `PreToolUse` - Before tool execution (can block/modify)
- `PostToolUse` - After successful tool execution
- `PostToolUseFailure` - After tool execution fails
- `PermissionRequest` - When permission check is triggered
- `PreCompact` - Before context compaction
- `PostCompact` - After context compaction
- `UserPromptSubmit` - When user submits a prompt
- `SessionStart` - When a new session starts
- `Notification` - Generic notification event

## Integration with Permission Policy Engine

PreToolUse hooks can be wired into the permission system:

```typescript
import { HookService } from './hooks/hookService';
import { PermissionPolicyEngine } from './permissions/policyEngine';

// Initialize services
const hookService = new HookService();
const policyEngine = new PermissionPolicyEngine();

// Wire PreToolUse hooks into policy engine
function registerHooksForProject(projectId: string, ctx: ToolContext) {
  const preToolHooks = hookService.getHooksForEvent("PreToolUse", projectId);
  
  for (const hookDef of preToolHooks) {
    policyEngine.addHook({
      name: `user_hook_${hookDef.id}`,
      phase: "pre",
      execute: async ({ tool, params, ctx }) => {
        const result = await hookService.executeHook({
          hookId: hookDef.id,
          eventType: "PreToolUse",
          eventPayload: { 
            tool_name: tool.name, 
            params 
          },
          context: {
            runId: ctx.runId,
            projectId: ctx.repoId,
            ticketId: ctx.ticketId,
            stage: ctx.stage,
          },
        });
        
        // If hook failed and continueOnError is false, deny
        if (!result.success && !hookDef.continueOnError) {
          return {
            override: true,
            decision: {
              decision: "deny",
              requiresApproval: false,
              reasons: [`Hook "${hookDef.name}" failed: ${result.error}`],
              source: "hook" as const,
            },
          };
        }
        
        // If hook provides a permission decision and canOverride is true
        if (result.permissionDecision && hookDef.canOverride) {
          return {
            override: true,
            decision: {
              decision: result.permissionDecision,
              requiresApproval: result.permissionDecision === "approval_required",
              reasons: [`Hook "${hookDef.name}" overrode permission`],
              source: "hook" as const,
            },
          };
        }
        
        // Otherwise, let normal policy evaluation continue
        return { override: false };
      },
    });
  }
}
```

## Usage Example

```typescript
// Create a command hook
const hook = hookService.createHook({
  name: "Block Dangerous Commands",
  description: "Prevents rm -rf and similar dangerous operations",
  enabled: true,
  eventType: "PreToolUse",
  hookType: "Command",
  command: "/path/to/check-dangerous-commands.js",
  promptTemplate: null,
  agentObjective: null,
  allowedTools: [],
  canOverride: true,
  continueOnError: false,
  timeoutMs: 5000,
  projectId: "my-project-123",
});

// Execute the hook
const result = await hookService.executeHook({
  hookId: hook.id,
  eventType: "PreToolUse",
  eventPayload: {
    tool_name: "bash",
    params: { command: "rm -rf /" },
  },
  context: {
    runId: "run_abc",
    projectId: "my-project-123",
    stage: "build",
  },
});

// Test a hook with sample data
const testResult = await hookService.testHook(hook.id, {
  tool_name: "bash",
  params: { command: "ls -la" },
});

// Query execution logs
const logs = hookService.getExecutionLog({
  hookId: hook.id,
  limit: 10,
});
```

## API Reference

### HookService

#### CRUD Operations
- `createHook(input)` - Create a new hook
- `getHook(id)` - Get hook by ID
- `updateHook(id, updates)` - Update hook
- `deleteHook(id)` - Delete hook
- `listHooks(filter?)` - List all hooks with optional filtering

#### Execution
- `executeHook(input)` - Execute a hook (logged)
- `testHook(hookId, testPayload)` - Test a hook (not logged)

#### Query
- `getHooksForEvent(eventType, projectId?)` - Get enabled hooks for an event
- `getExecutionLog(filter?)` - Get execution logs with optional filtering

## Configuration Options

### HookRecord Fields
- `name` - Display name
- `description` - Human-readable description
- `enabled` - Whether hook is active
- `eventType` - Which event triggers this hook
- `hookType` - "Command" | "Prompt" | "Agent"
- `command` - Shell command (for Command hooks)
- `promptTemplate` - LLM prompt (for Prompt hooks)
- `agentObjective` - Agent goal (for Agent hooks)
- `allowedTools` - Tools the hook can use (for Agent hooks)
- `canOverride` - Whether hook can override permission decisions
- `continueOnError` - Whether to continue if hook fails
- `timeoutMs` - Maximum execution time
- `projectId` - Optional project binding (null = global)

## Future Enhancements

1. **Prompt Hooks**: Integrate with `providerOrchestrator` for real LLM evaluation
2. **Agent Hooks**: Spawn `AgenticOrchestrator` runs with constrained tool access
3. **Persistence**: Add database backing for hooks and logs
4. **Hook Marketplace**: Share and download community hooks
5. **Advanced Filtering**: Complex event matching with JSONPath
6. **Conditional Execution**: Rule-based hook activation
