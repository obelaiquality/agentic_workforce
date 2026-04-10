import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders without crashing", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders a div with animate-pulse", () => {
    const { container } = render(<Skeleton />);
    expect(container.innerHTML).toContain("animate-pulse");
  });

  it("forwards className", () => {
    const { container } = render(<Skeleton className="custom-class" />);
    expect(container.innerHTML).toContain("custom-class");
  });
});
