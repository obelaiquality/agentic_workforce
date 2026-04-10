import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DimensionRadar } from "./DimensionRadar";
import type { InterviewDimensions } from "../../../shared/contracts";

// Mock recharts since jsdom does not support SVG rendering
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  RadarChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="radar-chart" data-count={data.length}>
      {children}
    </div>
  ),
  Radar: () => <div data-testid="radar" />,
  PolarGrid: () => <div data-testid="polar-grid" />,
  PolarAngleAxis: () => <div data-testid="polar-angle-axis" />,
  PolarRadiusAxis: () => <div data-testid="polar-radius-axis" />,
}));

describe("DimensionRadar", () => {
  it("renders empty state when dimensions object has no numeric values", () => {
    const emptyDimensions = {} as InterviewDimensions;

    render(<DimensionRadar dimensions={emptyDimensions} />);

    expect(screen.getByText("No dimensions yet")).toBeInTheDocument();
  });

  it("renders radar chart when dimensions are provided", () => {
    const dimensions: InterviewDimensions = {
      intent: 0.8,
      scope: 0.6,
      architecture: 0.7,
      constraints: 0.5,
      priorities: 0.9,
    };

    render(<DimensionRadar dimensions={dimensions} />);

    expect(screen.getByTestId("radar-chart")).toBeInTheDocument();
    expect(screen.getByTestId("radar-chart")).toHaveAttribute("data-count", "5");
    expect(screen.queryByText("No dimensions yet")).not.toBeInTheDocument();
  });

  it("renders with partial dimensions", () => {
    const dimensions = {
      intent: 0.4,
      scope: 0.7,
    } as InterviewDimensions;

    render(<DimensionRadar dimensions={dimensions} />);

    expect(screen.getByTestId("radar-chart")).toHaveAttribute("data-count", "2");
  });
});
