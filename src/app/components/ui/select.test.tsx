import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "./select";

describe("Select", () => {
  it("renders SelectTrigger with placeholder", () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Choose..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText("Choose...")).toBeInTheDocument();
  });

  it("applies data-slot to trigger", () => {
    const { container } = render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(
      container.querySelector('[data-slot="select-trigger"]'),
    ).toBeTruthy();
  });

  it("renders with SelectGroup and SelectLabel when open", () => {
    render(
      <Select open>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Fruits</SelectLabel>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText("Fruits")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });
});
