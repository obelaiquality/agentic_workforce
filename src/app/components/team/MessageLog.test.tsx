import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageLog } from "./MessageLog";

function makeMessage(overrides: Partial<{
  id: string;
  fromWorkerId: string;
  toWorkerId: string | null;
  content: string;
  read: boolean;
  createdAt: string;
}> = {}) {
  return {
    id: "msg-1",
    fromWorkerId: "worker-alpha",
    toWorkerId: null,
    content: "Starting task execution",
    read: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("MessageLog", () => {
  it("renders empty state when no messages", () => {
    render(<MessageLog messages={[]} />);

    expect(screen.getByText("No messages yet.")).toBeInTheDocument();
  });

  it("renders message content", () => {
    render(<MessageLog messages={[makeMessage()]} />);

    expect(screen.getByText("Starting task execution")).toBeInTheDocument();
    expect(screen.getByText("worker-alpha")).toBeInTheDocument();
  });

  it("shows broadcast label for messages without recipient", () => {
    render(<MessageLog messages={[makeMessage({ toWorkerId: null })]} />);

    expect(screen.getByText("broadcast")).toBeInTheDocument();
  });

  it("shows recipient for directed messages", () => {
    render(
      <MessageLog
        messages={[makeMessage({ toWorkerId: "worker-beta" })]}
      />,
    );

    // The arrow and recipient are rendered
    expect(screen.getByText(/worker-beta/)).toBeInTheDocument();
  });

  it("renders multiple messages", () => {
    render(
      <MessageLog
        messages={[
          makeMessage({ id: "msg-1", content: "First message" }),
          makeMessage({ id: "msg-2", content: "Second message", fromWorkerId: "worker-beta" }),
        ]}
      />,
    );

    expect(screen.getByText("First message")).toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("does not show send input when onSend is not provided", () => {
    render(<MessageLog messages={[]} />);

    expect(screen.queryByPlaceholderText("Send a message...")).not.toBeInTheDocument();
  });

  it("shows send input when onSend is provided", () => {
    render(<MessageLog messages={[]} onSend={vi.fn()} />);

    expect(screen.getByPlaceholderText("Send a message...")).toBeInTheDocument();
  });

  it("calls onSend with trimmed content on button click", () => {
    const onSend = vi.fn();
    render(<MessageLog messages={[]} onSend={onSend} />);

    const input = screen.getByPlaceholderText("Send a message...");
    fireEvent.change(input, { target: { value: "  Hello team  " } });

    // Find the send button (it wraps a Send icon)
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons.find((b) => !b.hasAttribute("disabled"));
    fireEvent.click(sendButton!);

    expect(onSend).toHaveBeenCalledWith("Hello team");
  });

  it("does not send empty messages", () => {
    const onSend = vi.fn();
    render(<MessageLog messages={[]} onSend={onSend} />);

    // The send button should be disabled when input is empty
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[0];
    expect(sendButton).toBeDisabled();
  });

  it("sends message on Enter key", () => {
    const onSend = vi.fn();
    render(<MessageLog messages={[]} onSend={onSend} />);

    const input = screen.getByPlaceholderText("Send a message...");
    fireEvent.change(input, { target: { value: "Enter message" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Enter message");
  });

  it("clears input after sending", () => {
    const onSend = vi.fn();
    render(<MessageLog messages={[]} onSend={onSend} />);

    const input = screen.getByPlaceholderText("Send a message...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input.value).toBe("");
  });

  it("highlights unread messages", () => {
    const { container } = render(
      <MessageLog messages={[makeMessage({ read: false })]} />,
    );

    const messageEl = container.querySelector(".border-blue-500\\/20");
    expect(messageEl).not.toBeNull();
  });
});
