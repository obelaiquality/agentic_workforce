import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConversationThread } from "./ConversationThread";
import type { ChatMessageDto } from "../../../shared/contracts";

function makeMessage(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: "msg-1",
    sessionId: "session-1",
    role: "user",
    content: "Hello world",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ConversationThread", () => {
  it("renders empty state when no messages", () => {
    render(<ConversationThread messages={[]} />);
    expect(screen.getByTestId("conversation-empty")).toBeInTheDocument();
    expect(screen.getByText("Start a conversation to begin")).toBeInTheDocument();
  });

  it("renders messages", () => {
    const messages: ChatMessageDto[] = [
      makeMessage({ id: "m1", role: "user", content: "Hello" }),
      makeMessage({ id: "m2", role: "assistant", content: "Hi there" }),
    ];
    render(<ConversationThread messages={messages} />);
    expect(screen.getByTestId("conversation-thread")).toBeInTheDocument();
    expect(screen.getByTestId("message-m1")).toBeInTheDocument();
    expect(screen.getByTestId("message-m2")).toBeInTheDocument();
  });

  it("shows a turn divider when role switches from assistant to user", () => {
    const now = new Date();
    const messages: ChatMessageDto[] = [
      makeMessage({ id: "m1", role: "assistant", content: "Response", createdAt: now.toISOString() }),
      makeMessage({
        id: "m2",
        role: "user",
        content: "Follow up",
        createdAt: new Date(now.getTime() + 1000).toISOString(),
      }),
    ];
    render(<ConversationThread messages={messages} />);
    expect(screen.getByTestId("turn-divider")).toBeInTheDocument();
  });

  it("does not show a divider for consecutive same-role messages", () => {
    const now = new Date();
    const messages: ChatMessageDto[] = [
      makeMessage({ id: "m1", role: "user", content: "First", createdAt: now.toISOString() }),
      makeMessage({
        id: "m2",
        role: "user",
        content: "Second",
        createdAt: new Date(now.getTime() + 1000).toISOString(),
      }),
    ];
    render(<ConversationThread messages={messages} />);
    expect(screen.queryByTestId("turn-divider")).not.toBeInTheDocument();
  });

  it("renders system messages", () => {
    const messages: ChatMessageDto[] = [
      makeMessage({ id: "s1", role: "system", content: "System initialized" }),
    ];
    render(<ConversationThread messages={messages} />);
    expect(screen.getByTestId("message-s1")).toBeInTheDocument();
    expect(screen.getByText("System initialized")).toBeInTheDocument();
  });

  it("renders streaming text fallback when isStreaming and streamingText provided", () => {
    render(
      <ConversationThread
        messages={[]}
        streamingText="Generating..."
        isStreaming
      />,
    );
    // Should not show empty state
    expect(screen.queryByTestId("conversation-empty")).not.toBeInTheDocument();
  });

  it("renders inline tool calls", () => {
    const messages: ChatMessageDto[] = [
      makeMessage({ id: "m1", role: "user", content: "Do something" }),
    ];
    const toolCalls = [
      {
        id: "tc-1",
        iteration: 1,
        name: "read_file",
        args: { path: "test.ts" },
        result: { type: "success" as const, content: "file contents", metadata: {} },
        policyDecision: "allow" as const,
        durationMs: 42,
        timestamp: new Date().toISOString(),
      },
    ];
    render(
      <ConversationThread
        messages={messages}
        toolCalls={toolCalls}
      />,
    );
    expect(screen.getByTestId("tool-call-inline")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("groups consecutive messages by same role", () => {
    const now = new Date();
    const messages: ChatMessageDto[] = [
      makeMessage({ id: "m1", role: "user", content: "First", createdAt: now.toISOString() }),
      makeMessage({
        id: "m2",
        role: "user",
        content: "Second",
        createdAt: new Date(now.getTime() + 500).toISOString(),
      }),
    ];
    render(<ConversationThread messages={messages} />);
    // Both messages should be present
    expect(screen.getByTestId("message-m1")).toBeInTheDocument();
    expect(screen.getByTestId("message-m2")).toBeInTheDocument();
    // Only first should show "You" label (group start)
    const youLabels = screen.getAllByText("You");
    expect(youLabels).toHaveLength(1);
  });
});
