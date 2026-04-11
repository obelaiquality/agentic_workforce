import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import React from "react";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "./form";

function TestForm() {
  const form = useForm({
    defaultValues: { name: "" },
  });
  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <input placeholder="Enter name" {...field} />
              </FormControl>
              <FormDescription>Your full name</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

describe("Form", () => {
  it("renders form with label", () => {
    render(<TestForm />);
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("renders form description", () => {
    render(<TestForm />);
    expect(screen.getByText("Your full name")).toBeInTheDocument();
  });

  it("renders form control with input", () => {
    render(<TestForm />);
    expect(screen.getByPlaceholderText("Enter name")).toBeInTheDocument();
  });

  it("applies data-slot attributes", () => {
    const { container } = render(<TestForm />);
    expect(container.querySelector('[data-slot="form-item"]')).toBeTruthy();
    expect(
      container.querySelector('[data-slot="form-label"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="form-description"]'),
    ).toBeTruthy();
  });

  it("renders FormMessage with error text when form field has error", async () => {
    function TestFormWithError() {
      const form = useForm({
        defaultValues: { email: "" },
      });

      // Trigger validation error programmatically
      React.useEffect(() => {
        form.setError("email", { type: "manual", message: "Email is required" });
      }, [form]);

      return (
        <Form {...form}>
          <form>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      );
    }

    render(<TestFormWithError />);
    await waitFor(() => {
      expect(screen.getByText("Email is required")).toBeInTheDocument();
    });
  });

  it("FormMessage returns null when there is no error and no children", () => {
    // The default TestForm has no errors, so FormMessage renders null
    const { container } = render(<TestForm />);
    // No form-message element should be present
    expect(container.querySelector('[data-slot="form-message"]')).toBeNull();
  });

  it("FormMessage renders children when provided and no error", () => {
    function TestFormWithChildren() {
      const form = useForm({ defaultValues: { name: "" } });
      return (
        <Form {...form}>
          <form>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <input {...field} />
                  </FormControl>
                  <FormMessage>Custom help text</FormMessage>
                </FormItem>
              )}
            />
          </form>
        </Form>
      );
    }

    render(<TestFormWithChildren />);
    expect(screen.getByText("Custom help text")).toBeInTheDocument();
  });

  it("FormControl sets aria-invalid when there is an error", async () => {
    function TestFormWithError() {
      const form = useForm({ defaultValues: { name: "" } });
      React.useEffect(() => {
        form.setError("name", { type: "manual", message: "Required" });
      }, [form]);
      return (
        <Form {...form}>
          <form>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <input data-testid="name-input" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      );
    }

    render(<TestFormWithError />);
    await waitFor(() => {
      const input = screen.getByTestId("name-input");
      expect(input.getAttribute("aria-invalid")).toBe("true");
    });
  });

  it("FormLabel applies error styling when field has error", async () => {
    function TestFormWithLabelError() {
      const form = useForm({ defaultValues: { name: "" } });
      React.useEffect(() => {
        form.setError("name", { type: "manual", message: "Bad" });
      }, [form]);
      return (
        <Form {...form}>
          <form>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      );
    }

    const { container } = render(<TestFormWithLabelError />);
    await waitFor(() => {
      const label = container.querySelector('[data-slot="form-label"]');
      expect(label?.getAttribute("data-error")).toBe("true");
    });
  });

  it("FormDescription applies data-slot and correct id", () => {
    const { container } = render(<TestForm />);
    const desc = container.querySelector('[data-slot="form-description"]');
    expect(desc).toBeTruthy();
    // The id should end with -form-item-description
    expect(desc?.getAttribute("id")).toMatch(/-form-item-description$/);
  });

  it("FormControl sets aria-describedby with description and message ids", () => {
    const { container } = render(<TestForm />);
    const control = container.querySelector('[data-slot="form-control"]');
    expect(control).toBeTruthy();
    // Without errors, aria-describedby should contain description id only
    const describedBy = control?.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toMatch(/-form-item-description/);
  });

  it("FormControl sets aria-describedby with both description and message ids when error", async () => {
    function TestFormWithError() {
      const form = useForm({ defaultValues: { name: "" } });
      React.useEffect(() => {
        form.setError("name", { type: "manual", message: "Required" });
      }, [form]);
      return (
        <Form {...form}>
          <form>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <input data-testid="ctrl-input" {...field} />
                  </FormControl>
                  <FormDescription>Help text</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      );
    }

    const { container } = render(<TestFormWithError />);
    await waitFor(() => {
      const control = container.querySelector('[data-slot="form-control"]');
      const describedBy = control?.getAttribute("aria-describedby") ?? "";
      expect(describedBy).toMatch(/-form-item-description/);
      expect(describedBy).toMatch(/-form-item-message/);
    });
  });

  it("FormItem generates unique id for context", () => {
    const { container } = render(<TestForm />);
    const item = container.querySelector('[data-slot="form-item"]');
    expect(item).toBeTruthy();
    // The item should have children that reference a unique id
    const label = container.querySelector('[data-slot="form-label"]');
    const htmlFor = label?.getAttribute("for") ?? "";
    expect(htmlFor).toMatch(/-form-item$/);
  });
});
