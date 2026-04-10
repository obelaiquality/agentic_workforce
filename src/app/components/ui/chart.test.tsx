import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ChartContainer, ChartStyle, type ChartConfig } from "./chart";

// Mock recharts ResponsiveContainer since it needs browser layout APIs
vi.mock("recharts", () => ({
  ResponsiveContainer: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="responsive-container">{children}</div>,
  Tooltip: () => null,
  Legend: () => null,
}));

beforeEach(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

const testConfig: ChartConfig = {
  revenue: {
    label: "Revenue",
    color: "#3b82f6",
  },
  expenses: {
    label: "Expenses",
    color: "#ef4444",
  },
};

describe("Chart", () => {
  it("renders ChartContainer with data-slot", () => {
    const { container } = render(
      <ChartContainer config={testConfig}>
        <div>Chart child</div>
      </ChartContainer>,
    );
    expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
  });

  it("renders ChartContainer with config producing style element", () => {
    const { container } = render(
      <ChartContainer config={testConfig}>
        <div>Chart</div>
      </ChartContainer>,
    );
    const style = container.querySelector("style");
    expect(style).toBeTruthy();
  });

  it("renders ChartStyle with color config", () => {
    const { container } = render(
      <ChartStyle id="test-chart" config={testConfig} />,
    );
    const style = container.querySelector("style");
    expect(style).toBeTruthy();
    expect(style?.innerHTML).toContain("--color-revenue");
    expect(style?.innerHTML).toContain("--color-expenses");
  });

  it("renders ChartStyle with empty config as null", () => {
    const emptyConfig: ChartConfig = {
      plain: { label: "Plain" },
    };
    const { container } = render(
      <ChartStyle id="test-chart" config={emptyConfig} />,
    );
    expect(container.querySelector("style")).toBeNull();
  });

  it("applies custom className to ChartContainer", () => {
    const { container } = render(
      <ChartContainer config={testConfig} className="my-chart">
        <div>Child</div>
      </ChartContainer>,
    );
    expect(container.querySelector(".my-chart")).toBeTruthy();
  });
});
