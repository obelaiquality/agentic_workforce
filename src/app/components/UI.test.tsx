import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip, Panel, PanelHeader, Button } from "./UI";

describe("UI Components", () => {
  describe("Chip", () => {
    it("renders children", () => {
      render(<Chip>Test Chip</Chip>);
      expect(screen.getByText("Test Chip")).toBeInTheDocument();
    });

    it("applies ok variant styling", () => {
      const { container } = render(<Chip variant="ok">OK Chip</Chip>);
      const chip = container.querySelector(".bg-emerald-500\\/10");
      expect(chip).toBeInTheDocument();
    });

    it("applies stop variant styling", () => {
      const { container } = render(<Chip variant="stop">Stop Chip</Chip>);
      const chip = container.querySelector(".bg-rose-500\\/10");
      expect(chip).toBeInTheDocument();
    });

    it("applies warn variant styling", () => {
      const { container } = render(<Chip variant="warn">Warn Chip</Chip>);
      const chip = container.querySelector(".bg-amber-500\\/10");
      expect(chip).toBeInTheDocument();
    });

    it("applies subtle variant styling by default", () => {
      const { container } = render(<Chip>Default Chip</Chip>);
      const chip = container.querySelector(".bg-zinc-800");
      expect(chip).toBeInTheDocument();
    });

    it("accepts custom className", () => {
      render(<Chip className="custom-class">Chip</Chip>);
      const chip = screen.getByText("Chip");
      expect(chip).toHaveClass("custom-class");
    });

    it("renders as different element when 'as' prop is provided", () => {
      render(<Chip as="div">Div Chip</Chip>);
      const chip = screen.getByText("Div Chip");
      expect(chip.tagName).toBe("DIV");
    });
  });

  describe("Panel", () => {
    it("renders children", () => {
      render(
        <Panel>
          <div>Panel Content</div>
        </Panel>
      );
      expect(screen.getByText("Panel Content")).toBeInTheDocument();
    });

    it("applies custom className", () => {
      const { container } = render(
        <Panel className="custom-panel">
          <div>Content</div>
        </Panel>
      );
      const panel = container.querySelector(".custom-panel");
      expect(panel).toBeInTheDocument();
    });

    it("adds data-testid attribute", () => {
      render(
        <Panel data-testid="test-panel">
          <div>Content</div>
        </Panel>
      );
      const panel = screen.getByTestId("test-panel");
      expect(panel).toBeInTheDocument();
    });

    it("applies base styling classes", () => {
      const { container } = render(
        <Panel>
          <div>Content</div>
        </Panel>
      );
      const panel = container.querySelector(".bg-\\[\\#121214\\]");
      expect(panel).toBeInTheDocument();
    });
  });

  describe("PanelHeader", () => {
    it("renders title", () => {
      render(<PanelHeader title="Test Title" />);
      expect(screen.getByText("Test Title")).toBeInTheDocument();
    });

    it("renders children", () => {
      render(
        <PanelHeader title="Title">
          <Chip>Status</Chip>
        </PanelHeader>
      );
      expect(screen.getByText("Title")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
    });

    it("renders with React node as title", () => {
      render(
        <PanelHeader title={<span className="custom-title">Custom Title</span>} />
      );
      const title = screen.getByText("Custom Title");
      expect(title).toHaveClass("custom-title");
    });

    it("applies custom className", () => {
      const { container } = render(
        <PanelHeader title="Title" className="custom-header" />
      );
      const header = container.querySelector(".custom-header");
      expect(header).toBeInTheDocument();
    });
  });

  describe("Button", () => {
    it("renders children", () => {
      render(<Button>Click Me</Button>);
      expect(screen.getByText("Click Me")).toBeInTheDocument();
    });

    it("applies primary variant styling", () => {
      const { container } = render(<Button variant="primary">Primary</Button>);
      const button = container.querySelector(".bg-purple-600");
      expect(button).toBeInTheDocument();
    });

    it("applies subtle variant styling by default", () => {
      const { container } = render(<Button>Subtle</Button>);
      const button = container.querySelector(".bg-zinc-800\\/80");
      expect(button).toBeInTheDocument();
    });

    it("handles click events", () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);
      const button = screen.getByText("Click Me");
      button.click();
      expect(handleClick).toHaveBeenCalledOnce();
    });

    it("can be disabled", () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByText("Disabled");
      expect(button).toBeDisabled();
    });

    it("accepts custom className", () => {
      render(<Button className="custom-button">Button</Button>);
      const button = screen.getByText("Button");
      expect(button).toHaveClass("custom-button");
    });

    it("passes through HTML button attributes", () => {
      render(<Button type="submit" aria-label="Submit Form">Submit</Button>);
      const button = screen.getByLabelText("Submit Form");
      expect(button).toHaveAttribute("type", "submit");
    });
  });
});
