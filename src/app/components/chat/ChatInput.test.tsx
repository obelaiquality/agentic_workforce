import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";

describe("ChatInput", () => {
  it("renders the textarea and send button", () => {
    render(
      <ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />,
    );
    expect(screen.getByTestId("chat-input-textarea")).toBeInTheDocument();
    expect(screen.getByTestId("chat-send-button")).toBeInTheDocument();
  });

  it("calls onChange when typing", () => {
    const onChange = vi.fn();
    render(
      <ChatInput value="" onChange={onChange} onSend={vi.fn()} />,
    );
    const textarea = screen.getByTestId("chat-input-textarea");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    expect(onChange).toHaveBeenCalledWith("Hello");
  });

  it("calls onSend when Enter is pressed with content", () => {
    const onSend = vi.fn();
    render(
      <ChatInput value="Hello" onChange={vi.fn()} onSend={onSend} />,
    );
    const textarea = screen.getByTestId("chat-input-textarea");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not call onSend when Enter is pressed with empty content", () => {
    const onSend = vi.fn();
    render(
      <ChatInput value="" onChange={vi.fn()} onSend={onSend} />,
    );
    const textarea = screen.getByTestId("chat-input-textarea");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend when Shift+Enter is pressed", () => {
    const onSend = vi.fn();
    render(
      <ChatInput value="Hello" onChange={vi.fn()} onSend={onSend} />,
    );
    const textarea = screen.getByTestId("chat-input-textarea");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows slash command popup when typing /", () => {
    function Wrapper() {
      const [val, setVal] = useState("");
      return <ChatInput value={val} onChange={setVal} onSend={vi.fn()} />;
    }
    render(<Wrapper />);
    const textarea = screen.getByTestId("chat-input-textarea");
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(screen.getByTestId("slash-popup")).toBeInTheDocument();
  });

  it("filters slash commands", () => {
    function Wrapper() {
      const [val, setVal] = useState("");
      return <ChatInput value={val} onChange={setVal} onSend={vi.fn()} />;
    }
    render(<Wrapper />);
    const textarea = screen.getByTestId("chat-input-textarea");
    fireEvent.change(textarea, { target: { value: "/com" } });
    expect(screen.getByTestId("slash-popup")).toBeInTheDocument();
    expect(screen.getByText("/commit")).toBeInTheDocument();
    expect(screen.getByText("/compact")).toBeInTheDocument();
    // Should not show unrelated commands
    expect(screen.queryByText("/debug")).not.toBeInTheDocument();
  });

  it("shows stop button when streaming", () => {
    const onStop = vi.fn();
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        onStop={onStop}
        isStreaming
      />,
    );
    expect(screen.getByTestId("chat-stop-button")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-send-button")).not.toBeInTheDocument();
    expect(screen.getByText("Agent is responding...")).toBeInTheDocument();
  });

  it("calls onStop when stop button is clicked", () => {
    const onStop = vi.fn();
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        onStop={onStop}
        isStreaming
      />,
    );
    fireEvent.click(screen.getByTestId("chat-stop-button"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("disables send button when isActing", () => {
    render(
      <ChatInput
        value="Hello"
        onChange={vi.fn()}
        onSend={vi.fn()}
        isActing
      />,
    );
    const sendButton = screen.getByTestId("chat-send-button");
    expect(sendButton).toBeDisabled();
  });

  it("shows plan mode indicator when planModeEnabled", () => {
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        planModeEnabled
        onTogglePlanMode={vi.fn()}
      />,
    );
    expect(screen.getByText("Plan mode")).toBeInTheDocument();
  });

  it("calls onTogglePlanMode when plan mode button is clicked", () => {
    const onTogglePlanMode = vi.fn();
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        planModeEnabled={false}
        onTogglePlanMode={onTogglePlanMode}
      />,
    );
    fireEvent.click(screen.getByTitle("Plan mode off"));
    expect(onTogglePlanMode).toHaveBeenCalledWith(true);
  });

  it("shows default helper text when not streaming", () => {
    render(
      <ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />,
    );
    expect(
      screen.getByText("Enter to send, Shift+Enter for newline, / for commands"),
    ).toBeInTheDocument();
  });

  it("calls onSend when send button is clicked with content", () => {
    const onSend = vi.fn();
    render(
      <ChatInput value="Some text" onChange={vi.fn()} onSend={onSend} />,
    );
    fireEvent.click(screen.getByTestId("chat-send-button"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("disables textarea when streaming", () => {
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        isStreaming
      />,
    );
    expect(screen.getByTestId("chat-input-textarea")).toBeDisabled();
  });
});
