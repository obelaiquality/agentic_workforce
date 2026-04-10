import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RadioGroup, RadioGroupItem } from "./radio-group";

describe("RadioGroup", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <RadioGroup defaultValue="option1">
        <RadioGroupItem value="option1" />
        <RadioGroupItem value="option2" />
      </RadioGroup>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders radio buttons", () => {
    const { container } = render(
      <RadioGroup defaultValue="option1">
        <RadioGroupItem value="option1" />
        <RadioGroupItem value="option2" />
      </RadioGroup>,
    );
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios.length).toBe(2);
  });

  it("forwards className to RadioGroup", () => {
    const { container } = render(
      <RadioGroup defaultValue="option1" className="custom-class">
        <RadioGroupItem value="option1" />
      </RadioGroup>,
    );
    expect(container.innerHTML).toContain("custom-class");
  });
});
