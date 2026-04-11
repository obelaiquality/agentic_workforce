import { render } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { Slider } from "./slider";

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("Slider", () => {
  it("renders without crashing", () => {
    const { container } = render(<Slider defaultValue={[50]} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders with slider role", () => {
    const { container } = render(<Slider defaultValue={[50]} />);
    expect(container.querySelector('[role="slider"]')).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(
      <Slider defaultValue={[50]} className="custom-class" />,
    );
    expect(container.innerHTML).toContain("custom-class");
  });

  it("renders with controlled value array", () => {
    const { container } = render(<Slider value={[30, 70]} />);
    const thumbs = container.querySelectorAll('[role="slider"]');
    expect(thumbs.length).toBe(2);
  });

  it("falls back to [min, max] when no value or defaultValue provided", () => {
    const { container } = render(<Slider min={10} max={90} />);
    const thumbs = container.querySelectorAll('[role="slider"]');
    expect(thumbs.length).toBe(2);
  });
});
