# Streaming Tool Executor

The `StreamingToolExecutor` is the core engine that executes tools as they arrive during LLM streaming. It bridges the gap between provider streams (SSE events from LLM APIs) and the agentic orchestrator.

## Overview

The executor processes a stream of `ProviderStreamEvent` objects and:

1. **Accumulates tool calls** from deltas (`tool_use_delta`)
2. **Executes tools immediately** when they arrive (`tool_use`)
3. **Manages concurrency** via semaphores and sequential queues
4. **Handles approvals** for destructive or sensitive operations
5. **Enforces timeouts** on individual tool executions
6. **Yields AgenticEvents** for UI/logging integration

## Architecture

```
┌─────────────────────┐
│  Provider Stream    │
│ (SSE from LLM API)  │
└──────────┬──────────┘
           │
           │ ProviderStreamEvent
           ▼
┌──────────────────────────────────────────────┐
│         StreamingToolExecutor                │
│                                              │
│  ┌─────────────┐    ┌──────────────────┐    │
│  │  Pending    │    │  Semaphore       │    │
│  │  Calls Map  │    │  (Concurrency)   │    │
│  └─────────────┘    └──────────────────┘    │
│                                              │
│  ┌─────────────┐    ┌──────────────────┐    │
│  │ Sequential  │    │  Approval        │    │
│  │   Queue     │    │   Checker        │    │
│  └─────────────┘    └──────────────────┘    │
│                                              │
│         │                                    │
│         │ executeValidated()                 │
│         ▼                                    │
│  ┌──────────────────┐                        │
│  │  Tool Registry   │                        │
│  └──────────────────┘                        │
└──────────────────────────────────────────────┘
           │
           │ AgenticEvent
           ▼
┌─────────────────────┐
│   Orchestrator      │
│ (Manages loop)      │
└─────────────────────┘
```

## Key Features

### 1. Immediate Execution

Tools are executed **as soon as they arrive** in the stream, not when the stream ends. This enables:
- Real-time progress updates
- Early failure detection
- Better user feedback

### 2. Delta Accumulation

The executor handles both patterns:
- **Full tool_use**: Complete input arrives in one event
- **Deltas**: Arguments arrive in chunks (`tool_use_delta`), then finalized

### 3. Concurrency Management

Two execution modes:

#### Concurrent-Safe Tools
- Execute in parallel (up to `maxConcurrentTools`, default 5)
- Read-only operations (e.g., `read_file`, `grep`)
- Controlled via semaphore

#### Sequential Tools
- Execute one-at-a-time in FIFO order
- Write operations (e.g., `edit_file`, `bash`)
- Marked with `concurrencySafe: false`

### 4. Approval Flow

Tools requiring approval are **not executed**. Instead:
1. Executor detects `requiresApproval` or `checkApproval` returns true
2. Yields `tool_approval_needed` event
3. Returns `approval_required` result
4. Orchestrator can block or prompt user

### 5. Timeout Protection

Each tool execution has a timeout (default: 120s). On timeout:
- Promise is rejected
- Error result is returned
- Semaphore permit is released
- Execution continues with other tools

## Usage

```typescript
import { StreamingToolExecutor } from "./execution/streamingToolExecutor";
import { ToolRegistry } from "./tools/registry";

const registry = new ToolRegistry();
// ... register tools ...

const ctx: ToolContext = {
  runId: "run-123",
  repoId: "repo-456",
  ticketId: "ticket-789",
  worktreePath: "/path/to/worktree",
  actor: "agent:coder_default",
  stage: "build",
  conversationHistory: [],
  createApproval: async (req) => ({ id: "approval-id" }),
  recordEvent: async (event) => {},
};

const executor = new StreamingToolExecutor(registry, ctx, {
  maxConcurrentTools: 5,
  toolTimeoutMs: 120000,
});

// Process provider stream
const stream = provider.stream({ messages, ... });

for await (const event of executor.processStream(stream)) {
  if (event.type === "tool_use_started") {
    console.log(`Tool started: ${event.name}`);
  } else if (event.type === "tool_result") {
    console.log(`Tool completed: ${event.name} in ${event.durationMs}ms`);
  } else if (event.type === "tool_approval_needed") {
    console.log(`Approval required for: ${event.name}`);
  }
}

// Retrieve results for next iteration
const results = executor.getToolResults();
// Add results to conversation and loop

executor.reset(); // Prepare for next iteration
```

## Event Flow Example

### Stream with 2 tools:

```
Provider Stream              Executor                    Events Yielded
───────────────              ────────                    ──────────────

tool_use(id=1, name=read)
                          ─> Execute read (concurrent)
                                                      → tool_use_started(id=1)

tool_use(id=2, name=grep)
                          ─> Execute grep (concurrent)
                                                      → tool_use_started(id=2)

done
                          ─> Await both tools
                          ─> read completes (50ms)
                                                      → tool_result(id=1, 50ms)
                          ─> grep completes (80ms)
                                                      → tool_result(id=2, 80ms)
```

### Stream with approval:

```
Provider Stream              Executor                    Events Yielded
───────────────              ────────                    ──────────────

tool_use(id=1, name=bash)
                          ─> Check approval
                          ─> requiresApproval=true
                                                      → tool_approval_needed(id=1)

done
                          ─> No pending tools
                                                      (no tool_result)
```

## API Reference

### Constructor

```typescript
new StreamingToolExecutor(
  registry: ToolRegistry,
  ctx: ToolContext,
  options?: StreamingToolExecutorOptions
)
```

**Options:**
- `maxConcurrentTools`: Maximum parallel tool executions (default: 5)
- `toolTimeoutMs`: Individual tool timeout in milliseconds (default: 120000)

### Methods

#### `processStream(stream: AsyncGenerator<ProviderStreamEvent>): AsyncGenerator<AgenticEvent>`

Main entry point. Processes the provider stream and yields events as tools execute.

**Yields:**
- `assistant_token`: Text content from LLM
- `assistant_thinking`: Reasoning/CoT content
- `tool_use_started`: Tool execution began
- `tool_result`: Tool execution completed (success or error)
- `tool_approval_needed`: Tool requires approval
- `error`: Stream or execution error

#### `getToolResults(): ToolResultBlock[]`

Returns all completed tool results from the last stream. Use this to build `tool_result` messages for the next LLM iteration.

#### `hadToolCalls(): boolean`

Returns `true` if any tools were called during the last stream.

#### `reset(): void`

Resets internal state for the next iteration. Call this before processing a new stream.

## Implementation Notes

### Pending Calls Map

```typescript
Map<string, {
  id: string;
  name: string;
  argumentsBuffer: string;  // Accumulated deltas
  promise?: Promise<ToolResult>;
  startedAt?: number;
}>
```

### Semaphore Pattern

The semaphore prevents resource exhaustion from too many concurrent tools:

```typescript
await semaphore.acquire();
try {
  const result = await registry.executeValidated(...);
  return result;
} finally {
  semaphore.release();
}
```

### Sequential Queue

Non-concurrent-safe tools are queued and processed one-at-a-time:

```typescript
while (sequentialQueue.length > 0) {
  const next = sequentialQueue.shift();
  await executeToolWithTimeout(next);
}
```

## Error Handling

The executor is **resilient** to:
- ✅ Invalid tool names → Returns error result
- ✅ Invalid input schemas → Returns validation error
- ✅ Tool execution failures → Returns error result
- ✅ Tool timeouts → Returns timeout error
- ✅ Stream failures → Awaits pending tools, then yields error event

**Never crashes** — always returns a `ToolResult` (even if type is `error`).

## Testing

Comprehensive test suite in `streamingToolExecutor.test.ts` covers:
- Basic tool execution
- Delta accumulation
- Concurrent vs sequential execution
- Approval handling (static and dynamic)
- Error handling (unknown tool, invalid input, execution errors)
- Timeout behavior
- Concurrency limits
- Stream event forwarding
- State reset

Run tests:
```bash
npx vitest run src/server/execution/streamingToolExecutor.test.ts
```

## Integration with Orchestrator

The orchestrator uses the executor in a loop:

```typescript
let iteration = 0;
let shouldContinue = true;

while (shouldContinue && iteration < maxIterations) {
  // 1. Create provider stream
  const stream = provider.stream({ messages });

  // 2. Process with executor
  for await (const event of executor.processStream(stream)) {
    // Yield events to UI/logging
    yield event;
  }

  // 3. Check if tools were called
  if (!executor.hadToolCalls()) {
    shouldContinue = false; // LLM stopped calling tools
    break;
  }

  // 4. Add tool results to conversation
  const results = executor.getToolResults();
  for (const result of results) {
    messages.push({
      role: "tool_result",
      content: JSON.stringify(result.result),
      toolUseId: result.toolUseId,
      toolName: result.toolName,
    });
  }

  // 5. Reset for next iteration
  executor.reset();
  iteration++;
}
```

## Future Enhancements

Potential improvements (not yet implemented):

1. **Tool result streaming**: Stream partial tool results (e.g., bash output lines)
2. **Priority queues**: High-priority tools execute first
3. **Resource limits**: Memory/CPU tracking per tool
4. **Retry logic**: Auto-retry transient failures (network, quota)
5. **Circuit breakers**: Disable failing tools after N consecutive errors
6. **Distributed execution**: Execute tools on remote workers
7. **Tool dependencies**: Wait for tool A before starting tool B

## Related Files

- `src/server/tools/types.ts` — Type definitions
- `src/server/tools/registry.ts` — Tool registry and validation
- `src/shared/contracts.ts` — Provider stream events
- `src/server/services/doomLoopDetector.ts` — Loop detection (used by orchestrator)
- `src/server/execution/types.ts` — Re-exported types
