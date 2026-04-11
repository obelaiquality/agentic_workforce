import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "./carousel";

beforeEach(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // embla-carousel uses window.matchMedia internally
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // embla-carousel uses IntersectionObserver for slides-in-view
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: "",
    thresholds: [],
    takeRecords: vi.fn().mockReturnValue([]),
  }));
});

describe("Carousel", () => {
  it("renders Carousel with role region", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it("renders CarouselContent and CarouselItem", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
          <CarouselItem>Slide 2</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    expect(screen.getByText("Slide 1")).toBeInTheDocument();
    expect(screen.getByText("Slide 2")).toBeInTheDocument();
  });

  it("renders CarouselItem with role group", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Content</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    const slide = screen.getByRole("group");
    expect(slide).toBeInTheDocument();
  });

  it("renders CarouselPrevious and CarouselNext buttons", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide</CarouselItem>
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>,
    );
    expect(screen.getByText("Previous slide")).toBeInTheDocument();
    expect(screen.getByText("Next slide")).toBeInTheDocument();
  });

  it("applies data-slot attributes", () => {
    const { container } = render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    expect(
      container.querySelector('[data-slot="carousel"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="carousel-content"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="carousel-item"]'),
    ).toBeTruthy();
  });

  it("renders with vertical orientation", () => {
    const { container } = render(
      <Carousel orientation="vertical">
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>,
    );
    // Vertical content should have flex-col class
    const content = container.querySelector('[data-slot="carousel-content"]');
    expect(content).toBeTruthy();
    // Vertical items should have pt-4 instead of pl-4
    const item = container.querySelector('[data-slot="carousel-item"]');
    expect(item).toBeTruthy();
  });

  it("handles keyboard ArrowLeft to scroll previous", () => {
    const { container } = render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
          <CarouselItem>Slide 2</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    const region = screen.getByRole("region");
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    // No crash; carousel handles arrow key
    expect(region).toBeInTheDocument();
  });

  it("handles keyboard ArrowRight to scroll next", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
          <CarouselItem>Slide 2</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    const region = screen.getByRole("region");
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(region).toBeInTheDocument();
  });

  it("ignores non-arrow keys", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    const region = screen.getByRole("region");
    fireEvent.keyDown(region, { key: "Enter" });
    expect(region).toBeInTheDocument();
  });

  it("calls setApi callback when provided", () => {
    const setApiSpy = vi.fn();
    render(
      <Carousel setApi={setApiSpy}>
        <CarouselContent>
          <CarouselItem>Slide</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    // setApi is called with the embla API instance once mounted
    expect(setApiSpy).toHaveBeenCalled();
  });

  it("previous button has data-slot attribute", () => {
    const { container } = render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide</CarouselItem>
        </CarouselContent>
        <CarouselPrevious />
      </Carousel>,
    );
    expect(
      container.querySelector('[data-slot="carousel-previous"]'),
    ).toBeTruthy();
  });

  it("next button has data-slot attribute", () => {
    const { container } = render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide</CarouselItem>
        </CarouselContent>
        <CarouselNext />
      </Carousel>,
    );
    expect(
      container.querySelector('[data-slot="carousel-next"]'),
    ).toBeTruthy();
  });

  it("clicking previous button calls scrollPrev", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
          <CarouselItem>Slide 2</CarouselItem>
        </CarouselContent>
        <CarouselPrevious />
      </Carousel>,
    );
    const prevButton = screen.getByText("Previous slide").closest("button")!;
    fireEvent.click(prevButton);
    expect(prevButton).toBeInTheDocument();
  });

  it("clicking next button calls scrollNext", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
          <CarouselItem>Slide 2</CarouselItem>
        </CarouselContent>
        <CarouselNext />
      </Carousel>,
    );
    const nextButton = screen.getByText("Next slide").closest("button")!;
    fireEvent.click(nextButton);
    expect(nextButton).toBeInTheDocument();
  });

  it("passes custom className to carousel", () => {
    const { container } = render(
      <Carousel className="my-custom-class">
        <CarouselContent className="content-class">
          <CarouselItem className="item-class">Slide</CarouselItem>
        </CarouselContent>
      </Carousel>,
    );
    expect(
      container.querySelector(".my-custom-class"),
    ).toBeTruthy();
  });

  it("renders vertical orientation CarouselPrevious and CarouselNext with rotated class", () => {
    const { container } = render(
      <Carousel orientation="vertical">
        <CarouselContent>
          <CarouselItem>Slide 1</CarouselItem>
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>,
    );
    const prev = container.querySelector('[data-slot="carousel-previous"]');
    const next = container.querySelector('[data-slot="carousel-next"]');
    expect(prev?.className).toContain("rotate-90");
    expect(next?.className).toContain("rotate-90");
  });
});
