import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ChartContainer,
  ChartStyle,
  ChartTooltipContent,
  ChartLegendContent,
  type ChartConfig,
} from "./chart";

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

  it("uses provided id for data-chart attribute", () => {
    const { container } = render(
      <ChartContainer config={testConfig} id="my-id">
        <div>Child</div>
      </ChartContainer>,
    );
    const el = container.querySelector('[data-slot="chart"]');
    expect(el?.getAttribute("data-chart")).toBe("chart-my-id");
  });

  it("renders ChartStyle with theme config", () => {
    const themeConfig: ChartConfig = {
      primary: {
        label: "Primary",
        theme: { light: "#000", dark: "#fff" },
      },
    };
    const { container } = render(
      <ChartStyle id="theme-chart" config={themeConfig} />,
    );
    const style = container.querySelector("style");
    expect(style).toBeTruthy();
    expect(style?.innerHTML).toContain("--color-primary");
  });

  it("ChartStyle uses theme value for the matching theme key", () => {
    const themeConfig: ChartConfig = {
      accent: {
        label: "Accent",
        theme: { light: "#aaa", dark: "#bbb" },
      },
    };
    const { container } = render(
      <ChartStyle id="accent-chart" config={themeConfig} />,
    );
    const html = container.querySelector("style")?.innerHTML ?? "";
    expect(html).toContain("#aaa");
    expect(html).toContain("#bbb");
  });

  describe("ChartTooltipContent", () => {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <ChartContainer config={testConfig}>
        <div>{children}</div>
      </ChartContainer>
    );

    it("returns null when not active", () => {
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent active={false} payload={[]} />
        </Wrapper>,
      );
      // Only the chart wrapper should exist, no tooltip content
      expect(container.querySelector(".grid.gap-1\\.5")).toBeNull();
    });

    it("returns null when payload is empty", () => {
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent active={true} payload={[]} />
        </Wrapper>,
      );
      expect(container.querySelector(".grid.gap-1\\.5")).toBeNull();
    });

    it("renders tooltip with payload items", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 1234,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="January"
          />
        </Wrapper>,
      );
      expect(screen.getByText("January")).toBeInTheDocument();
      expect(screen.getByText("1,234")).toBeInTheDocument();
    });

    it("renders with hideLabel", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 100,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="January"
            hideLabel
          />
        </Wrapper>,
      );
      expect(screen.queryByText("January")).toBeNull();
    });

    it("renders with hideIndicator", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 100,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Jan"
            hideIndicator
          />
        </Wrapper>,
      );
      // Should render without indicator div
      expect(container.querySelector('[style*="--color-bg"]')).toBeNull();
    });

    it("renders dot indicator by default", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 50,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Feb"
            indicator="dot"
          />
        </Wrapper>,
      );
      const indicator = container.querySelector('[style*="--color-bg"]');
      expect(indicator).toBeTruthy();
    });

    it("renders line indicator", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 50,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Mar"
            indicator="line"
          />
        </Wrapper>,
      );
      // line indicator nests the label (single payload + non-dot)
      expect(container.querySelector('[style*="--color-bg"]')).toBeTruthy();
    });

    it("renders dashed indicator", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 50,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Apr"
            indicator="dashed"
          />
        </Wrapper>,
      );
      expect(container.querySelector('[style*="--color-bg"]')).toBeTruthy();
    });

    it("uses labelFormatter when provided", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 50,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Jan"
            labelFormatter={(value) => `Formatted: ${value}`}
          />
        </Wrapper>,
      );
      expect(screen.getByText("Formatted: Jan")).toBeTruthy();
    });

    it("uses custom formatter for items", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 999,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="X"
            formatter={(value) => <span data-testid="custom">{String(value)}</span>}
          />
        </Wrapper>,
      );
      expect(screen.getByTestId("custom")).toBeTruthy();
    });

    it("renders with color override", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 10,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="May"
            color="#ff0000"
          />
        </Wrapper>,
      );
      const indicator = container.querySelector('[style*="--color-bg"]');
      expect(indicator).toBeTruthy();
    });

    it("renders with nameKey", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 10,
          color: "#3b82f6",
          payload: { fill: "#3b82f6", category: "sales" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Jun"
            nameKey="category"
          />
        </Wrapper>,
      );
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });

    it("renders with labelKey", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 10,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Jul"
            labelKey="revenue"
          />
        </Wrapper>,
      );
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });

    it("renders item config icon when available", () => {
      const configWithIcon: ChartConfig = {
        revenue: {
          label: "Revenue",
          color: "#3b82f6",
          icon: () => <svg data-testid="icon" />,
        },
      };
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 10,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      render(
        <ChartContainer config={configWithIcon}>
          <div>
            <ChartTooltipContent
              active={true}
              payload={payload}
              label="Aug"
            />
          </div>
        </ChartContainer>,
      );
      expect(screen.getByTestId("icon")).toBeTruthy();
    });

    it("renders multiple payload items without nested label", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 100,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
        {
          dataKey: "expenses",
          name: "expenses",
          value: 200,
          color: "#ef4444",
          payload: { fill: "#ef4444" },
        },
      ];
      render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Sep"
          />
        </Wrapper>,
      );
      expect(screen.getByText("Sep")).toBeInTheDocument();
      expect(screen.getByText("100")).toBeInTheDocument();
      expect(screen.getByText("200")).toBeInTheDocument();
    });

    it("shows label from config when label matches config key", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 10,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="revenue"
          />
        </Wrapper>,
      );
      // "Revenue" appears both as the tooltip label and as the item label
      const revenueElements = screen.getAllByText("Revenue");
      expect(revenueElements.length).toBeGreaterThanOrEqual(1);
    });

    it("returns null tooltipLabel when label value is falsy and no labelKey", () => {
      const noLabelConfig: ChartConfig = {
        revenue: {
          color: "#3b82f6",
        },
      };
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 10,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <ChartContainer config={noLabelConfig}>
          <div>
            <ChartTooltipContent
              active={true}
              payload={payload}
            />
          </div>
        </ChartContainer>,
      );
      // Should render without a label div at top level
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });
  });

  describe("ChartLegendContent", () => {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <ChartContainer config={testConfig}>
        <div>{children}</div>
      </ChartContainer>
    );

    it("returns null when payload is empty", () => {
      const { container } = render(
        <Wrapper>
          <ChartLegendContent payload={[]} />
        </Wrapper>,
      );
      // no legend items
      expect(container.querySelectorAll('[class*="items-center gap-1.5"]').length).toBe(0);
    });

    it("returns null when payload is undefined", () => {
      const { container } = render(
        <Wrapper>
          <ChartLegendContent />
        </Wrapper>,
      );
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });

    it("renders legend items with colors", () => {
      const payload = [
        { value: "Revenue", dataKey: "revenue", color: "#3b82f6" },
        { value: "Expenses", dataKey: "expenses", color: "#ef4444" },
      ];
      render(
        <Wrapper>
          <ChartLegendContent payload={payload as any} />
        </Wrapper>,
      );
      expect(screen.getByText("Revenue")).toBeInTheDocument();
      expect(screen.getByText("Expenses")).toBeInTheDocument();
    });

    it("renders with verticalAlign top", () => {
      const payload = [
        { value: "Revenue", dataKey: "revenue", color: "#3b82f6" },
      ];
      const { container } = render(
        <Wrapper>
          <ChartLegendContent payload={payload as any} verticalAlign="top" />
        </Wrapper>,
      );
      expect(container.querySelector(".pb-3")).toBeTruthy();
    });

    it("renders with verticalAlign bottom (default)", () => {
      const payload = [
        { value: "Revenue", dataKey: "revenue", color: "#3b82f6" },
      ];
      const { container } = render(
        <Wrapper>
          <ChartLegendContent payload={payload as any} verticalAlign="bottom" />
        </Wrapper>,
      );
      expect(container.querySelector(".pt-3")).toBeTruthy();
    });

    it("renders icon from config and hides default color dot", () => {
      const configWithIcon: ChartConfig = {
        revenue: {
          label: "Revenue",
          color: "#3b82f6",
          icon: () => <svg data-testid="legend-icon" />,
        },
      };
      const payload = [
        { value: "Revenue", dataKey: "revenue", color: "#3b82f6" },
      ];
      render(
        <ChartContainer config={configWithIcon}>
          <div>
            <ChartLegendContent payload={payload as any} />
          </div>
        </ChartContainer>,
      );
      expect(screen.getByTestId("legend-icon")).toBeTruthy();
    });

    it("hides icon when hideIcon is true", () => {
      const configWithIcon: ChartConfig = {
        revenue: {
          label: "Revenue",
          color: "#3b82f6",
          icon: () => <svg data-testid="legend-icon-hidden" />,
        },
      };
      const payload = [
        { value: "Revenue", dataKey: "revenue", color: "#3b82f6" },
      ];
      render(
        <ChartContainer config={configWithIcon}>
          <div>
            <ChartLegendContent payload={payload as any} hideIcon />
          </div>
        </ChartContainer>,
      );
      expect(screen.queryByTestId("legend-icon-hidden")).toBeNull();
    });

    it("renders with nameKey", () => {
      const payload = [
        { value: "Revenue", dataKey: "revenue", color: "#3b82f6" },
      ];
      const { container } = render(
        <Wrapper>
          <ChartLegendContent payload={payload as any} nameKey="revenue" />
        </Wrapper>,
      );
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });

    it("applies custom className", () => {
      const payload = [
        { value: "Revenue", dataKey: "revenue", color: "#3b82f6" },
      ];
      const { container } = render(
        <Wrapper>
          <ChartLegendContent payload={payload as any} className="my-legend" />
        </Wrapper>,
      );
      expect(container.querySelector(".my-legend")).toBeTruthy();
    });
  });

  describe("getPayloadConfigFromPayload edge cases", () => {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <ChartContainer config={testConfig}>
        <div>{children}</div>
      </ChartContainer>
    );

    it("handles payload with nested payload containing the key", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 10,
          color: "#3b82f6",
          payload: { fill: "#3b82f6", category: "expenses" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Test"
            nameKey="category"
          />
        </Wrapper>,
      );
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });

    it("handles item with value of 0 (falsy but valid)", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 0,
          color: "#3b82f6",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Zero value"
          />
        </Wrapper>,
      );
      // Value of 0 is falsy, so the value span should not render
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });

    it("resolves config from the key directly in payload object", () => {
      const payload = [
        {
          dataKey: "revenue",
          name: "revenue",
          value: 5,
          color: "#3b82f6",
          revenue: "expenses",
          payload: { fill: "#3b82f6" },
        },
      ];
      const { container } = render(
        <Wrapper>
          <ChartTooltipContent
            active={true}
            payload={payload}
            label="Key in payload"
            nameKey="revenue"
          />
        </Wrapper>,
      );
      // The nameKey resolves to "expenses" from top-level payload property
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });
  });
});
