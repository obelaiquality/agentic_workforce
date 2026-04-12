import { Panel } from "../UI";
import { ConversationThread } from "./ConversationThread";
import { ChatInput } from "./ChatInput";
import type { MissionData } from "../command-center/types";
import type { AgenticToolCallRecord } from "../../../shared/contracts";

export interface ConversationViewProps {
  mission: MissionData;
}

export function ConversationView({ mission }: ConversationViewProps) {
  const {
    messages,
    input,
    setInput,
    streaming,
    isExecuting,
    isActing,
    sendMessage,
    refreshSnapshot,
    agenticRun,
    planModeEnabled,
    setPlanModeEnabled,
  } = mission;

  // Extract live streaming text from the agentic run
  const liveStreamingText = agenticRun?.lastAssistantText || "";
  const isAgentStreaming = streaming || agenticRun?.status === "running";

  // Collect tool calls from the agentic run for inline display
  const toolCalls: AgenticToolCallRecord[] = agenticRun?.toolCalls ?? [];

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage();
  };

  const handleStop = () => {
    refreshSnapshot();
  };

  return (
    <Panel
      className="flex flex-col border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.05),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.07),transparent_22%),#111113] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
      data-testid="conversation-view"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-white">Chat</h2>
          {isAgentStreaming && (
            <span className="flex items-center gap-1 text-[10px] text-cyan-400/70">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              Active
            </span>
          )}
        </div>
        {mission.selectedRepo && (
          <span
            className="max-w-[180px] truncate rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400"
            title={mission.selectedRepo.displayName}
          >
            {mission.selectedRepo.displayName}
          </span>
        )}
      </div>

      {/* Thread */}
      <div className="flex-1 min-h-0 flex flex-col">
        <ConversationThread
          messages={messages}
          streamingText={liveStreamingText}
          isStreaming={Boolean(isAgentStreaming)}
          toolCalls={toolCalls}
        />
      </div>

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={Boolean(isAgentStreaming)}
        isActing={isActing}
        planModeEnabled={planModeEnabled}
        onTogglePlanMode={setPlanModeEnabled}
        placeholder={
          mission.activeProjectIsBlank
            ? "Describe what you want to build..."
            : "Send a message..."
        }
      />
    </Panel>
  );
}
