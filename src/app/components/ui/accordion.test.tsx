import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./accordion";

describe("Accordion", () => {
  it("renders Accordion with items", () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Section 1</AccordionTrigger>
          <AccordionContent>Content 1</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByText("Section 1")).toBeInTheDocument();
  });

  it("renders multiple AccordionItems", () => {
    render(
      <Accordion type="multiple">
        <AccordionItem value="a">
          <AccordionTrigger>First</AccordionTrigger>
          <AccordionContent>First content</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>Second</AccordionTrigger>
          <AccordionContent>Second content</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders AccordionTrigger as a button", () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Click me</AccordionTrigger>
          <AccordionContent>Hidden</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    const trigger = screen.getByText("Click me");
    expect(trigger.closest("button")).toBeTruthy();
  });

  it("applies data-slot attributes", () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(
      container.querySelector('[data-slot="accordion-item"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="accordion-trigger"]'),
    ).toBeTruthy();
  });
});
