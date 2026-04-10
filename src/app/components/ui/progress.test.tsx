import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Progress } from "./progress";

describe("Progress", () => {
  it("renders without crashing", () => {
    const { container } = render(<Progress value={50} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders with progressbar role", () => {
    const { container } = render(<Progress value={50} />);
    expect(container.querySelector('[role="progressbar"]')).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(
      <Progress value={50} className="custom-class" />,
    );
    expect(container.innerHTML).toContain("custom-class");
  });
});
