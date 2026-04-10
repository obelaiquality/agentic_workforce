import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Calendar } from "./calendar";

describe("Calendar", () => {
  it("renders without crashing", () => {
    const { container } = render(<Calendar />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders with a specific month", () => {
    const { container } = render(
      <Calendar month={new Date(2025, 0, 1)} />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("applies custom className", () => {
    const { container } = render(<Calendar className="custom-cal" />);
    expect(container.querySelector(".custom-cal")).toBeTruthy();
  });
});
