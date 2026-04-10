import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
