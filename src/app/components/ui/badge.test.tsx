import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders without crashing", () => {
    const { container } = render(<Badge>Test</Badge>);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders children", () => {
    const { container } = render(<Badge>Badge Text</Badge>);
    expect(container.textContent).toBe("Badge Text");
  });

  it("forwards className", () => {
    const { container } = render(<Badge className="custom-class">Test</Badge>);
    expect(container.innerHTML).toContain("custom-class");
  });
});
