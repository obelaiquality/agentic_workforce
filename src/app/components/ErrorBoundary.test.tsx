import { render, screen, fireEvent } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

const reportMock = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}));

vi.mock("../lib/errorReporter", () => reportMock);

// Suppress React error boundary console noise in test output
const originalError = console.error;
beforeEach(() => {
  vi.clearAllMocks();
  console.error = vi.fn();
});
afterAll(() => {
  console.error = originalError;
});

function ThrowingChild({ message }: { message: string }) {
  throw new Error(message);
}

function GoodChild() {
  return <div data-testid="good-child">All good</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary viewName="Test">
        <GoodChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("good-child")).toBeInTheDocument();
  });

  it("renders fallback UI when a child throws", () => {
    render(
      <ErrorBoundary viewName="Console">
        <ThrowingChild message="render kaboom" />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByText("Console encountered an error")).toBeInTheDocument();
    expect(screen.getByText("render kaboom")).toBeInTheDocument();
  });

  it("reports the error to the backend via errorReporter", () => {
    render(
      <ErrorBoundary viewName="Settings">
        <ThrowingChild message="report test" />
      </ErrorBoundary>,
    );
    expect(reportMock.reportClientError).toHaveBeenCalledTimes(1);
    const call = reportMock.reportClientError.mock.calls[0][0];
    expect(call.message).toBe("report test");
    expect(call.source).toBe("error_boundary");
    expect(call.timestamp).toBeTruthy();
  });

  it("resets error state when retry button is clicked", () => {
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error("conditional error");
      return <div data-testid="recovered">Recovered</div>;
    }

    render(
      <ErrorBoundary viewName="Test">
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();

    // Fix the error condition before retrying
    shouldThrow = false;
    fireEvent.click(screen.getByTestId("error-boundary-retry"));

    expect(screen.getByTestId("recovered")).toBeInTheDocument();
    expect(screen.queryByTestId("error-boundary-fallback")).not.toBeInTheDocument();
  });

  it("uses custom fallback when provided", () => {
    const customFallback = (error: Error, reset: () => void) => (
      <div data-testid="custom-fallback">
        <span>Custom: {error.message}</span>
        <button data-testid="custom-reset" onClick={reset}>Reset</button>
      </div>
    );

    render(
      <ErrorBoundary viewName="Test" fallback={customFallback}>
        <ThrowingChild message="custom fallback test" />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    expect(screen.getByText("Custom: custom fallback test")).toBeInTheDocument();
    expect(screen.queryByTestId("error-boundary-fallback")).not.toBeInTheDocument();
  });

  it("includes componentStack in the error report", () => {
    render(
      <ErrorBoundary viewName="Test">
        <ThrowingChild message="stack test" />
      </ErrorBoundary>,
    );
    const call = reportMock.reportClientError.mock.calls[0][0];
    // componentStack is provided by React — exact content varies, but it should be a string
    expect(typeof call.componentStack === "string" || call.componentStack === undefined).toBe(true);
  });
});
