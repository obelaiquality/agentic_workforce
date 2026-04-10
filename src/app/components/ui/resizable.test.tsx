import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "./resizable";

beforeEach(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

describe("Resizable", () => {
  it("renders ResizablePanelGroup with panels", () => {
    const { container } = render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={50}>Panel A</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50}>Panel B</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(
      container.querySelector('[data-slot="resizable-panel-group"]'),
    ).toBeTruthy();
  });

  it("renders ResizableHandle with data-slot", () => {
    const { container } = render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={50}>Left</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50}>Right</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(
      container.querySelector('[data-slot="resizable-handle"]'),
    ).toBeTruthy();
  });

  it("renders ResizableHandle with grip icon when withHandle is true", () => {
    const { container } = render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={50}>Left</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50}>Right</ResizablePanel>
      </ResizablePanelGroup>,
    );
    const handle = container.querySelector(
      '[data-slot="resizable-handle"]',
    );
    expect(handle).toBeTruthy();
    // The withHandle variant renders a nested div with the grip icon
    expect(handle?.querySelector("svg")).toBeTruthy();
  });

  it("renders vertical panel group", () => {
    const { container } = render(
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={50}>Top</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50}>Bottom</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(
      container.querySelector('[data-slot="resizable-panel-group"]'),
    ).toBeTruthy();
  });
});
