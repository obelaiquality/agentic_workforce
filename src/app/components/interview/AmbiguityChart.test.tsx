import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AmbiguityChart } from "./AmbiguityChart";

// Mock recharts since jsdom does not support SVG rendering
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="area-chart" data-count={data.length}>
      {children}
    </div>
  ),
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ReferenceLine: ({ y }: { y: number }) => (
    <div data-testid="reference-line" data-value={y} />
  ),
}));

describe("AmbiguityChart", () => {
  it("renders empty state when no scores provided", () => {
    render(<AmbiguityChart scores={[]} threshold={0.3} />);

    expect(screen.getByText("No scores yet")).toBeInTheDocument();
  });

  it("renders chart when scores are provided", () => {
    const scores = [
      { round: 1, overall: 0.8 },
      { round: 2, overall: 0.5 },
      { round: 3, overall: 0.25 },
    ];

    render(<AmbiguityChart scores={scores} threshold={0.3} />);

    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
    expect(screen.getByTestId("area-chart")).toHaveAttribute("data-count", "3");
    expect(screen.queryByText("No scores yet")).not.toBeInTheDocument();
  });

  it("renders threshold reference line", () => {
    const scores = [{ round: 1, overall: 0.5 }];

    render(<AmbiguityChart scores={scores} threshold={0.3} />);

    expect(screen.getByTestId("reference-line")).toHaveAttribute("data-value", "0.3");
  });

  it("renders single data point", () => {
    render(<AmbiguityChart scores={[{ round: 1, overall: 0.9 }]} threshold={0.3} />);

    expect(screen.getByTestId("area-chart")).toHaveAttribute("data-count", "1");
  });
});
