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
});
