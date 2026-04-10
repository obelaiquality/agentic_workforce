import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./QuestionCard";
import type { QuestionCardQuestion } from "./QuestionCard";

function makeQuestion(overrides: Partial<QuestionCardQuestion> = {}): QuestionCardQuestion {
  return {
    id: "q-1",
    question: "What is the deployment strategy?",
    round: 2,
    targetDimension: "infrastructure",
    ...overrides,
  };
}

describe("QuestionCard", () => {
  it("renders question text and round badge", () => {
    render(
      <QuestionCard question={makeQuestion()} onSubmit={vi.fn()} isSubmitting={false} />,
    );

    expect(screen.getByText("What is the deployment strategy?")).toBeInTheDocument();
    expect(screen.getByText("Round 2")).toBeInTheDocument();
    expect(screen.getByText("infrastructure")).toBeInTheDocument();
  });

  it("renders challenge mode badge when present", () => {
    render(
      <QuestionCard
        question={makeQuestion({ challengeMode: "contrarian" })}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.getByText("contrarian")).toBeInTheDocument();
  });

  it("shows textarea and submit button when unanswered", () => {
    render(
      <QuestionCard question={makeQuestion()} onSubmit={vi.fn()} isSubmitting={false} />,
    );

    expect(screen.getByPlaceholderText("Type your answer...")).toBeInTheDocument();
    expect(screen.getByText("Submit Answer")).toBeInTheDocument();
  });

  it("shows answer text when question has been answered", () => {
    render(
      <QuestionCard
        question={makeQuestion({ answer: "We use blue-green deployment." })}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.getByText("We use blue-green deployment.")).toBeInTheDocument();
    expect(screen.getByText("Your Answer")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type your answer...")).not.toBeInTheDocument();
  });

  it("calls onSubmit with trimmed text when submit button is clicked", () => {
    const onSubmit = vi.fn();
    render(
      <QuestionCard question={makeQuestion()} onSubmit={onSubmit} isSubmitting={false} />,
    );

    const textarea = screen.getByPlaceholderText("Type your answer...");
    fireEvent.change(textarea, { target: { value: "  My answer  " } });

    const submitButton = screen.getByText("Submit Answer");
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith("My answer");
  });

  it("does not submit empty or whitespace-only answers", () => {
    const onSubmit = vi.fn();
    render(
      <QuestionCard question={makeQuestion()} onSubmit={onSubmit} isSubmitting={false} />,
    );

    const submitButton = screen.getByText("Submit Answer");
    fireEvent.click(submitButton);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables textarea and button when isSubmitting is true", () => {
    render(
      <QuestionCard question={makeQuestion()} onSubmit={vi.fn()} isSubmitting={true} />,
    );

    expect(screen.getByPlaceholderText("Type your answer...")).toBeDisabled();
    expect(screen.getByText("Submitting...")).toBeInTheDocument();
  });

  it("submits on Cmd+Enter", () => {
    const onSubmit = vi.fn();
    render(
      <QuestionCard question={makeQuestion()} onSubmit={onSubmit} isSubmitting={false} />,
    );

    const textarea = screen.getByPlaceholderText("Type your answer...");
    fireEvent.change(textarea, { target: { value: "keyboard submit" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    expect(onSubmit).toHaveBeenCalledWith("keyboard submit");
  });

  it("clears the draft after submit", () => {
    const onSubmit = vi.fn();
    render(
      <QuestionCard question={makeQuestion()} onSubmit={onSubmit} isSubmitting={false} />,
    );

    const textarea = screen.getByPlaceholderText("Type your answer...") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "answer text" } });
    fireEvent.click(screen.getByText("Submit Answer"));

    expect(textarea.value).toBe("");
  });
});
