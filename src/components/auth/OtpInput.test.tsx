// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { OtpInput } from "./OtpInput";

describe("OtpInput Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 6 single-digit numeric input boxes", () => {
    render(<OtpInput value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(6);
    inputs.forEach((input) => {
      expect(input).toHaveAttribute("inputmode", "numeric");
      expect(input).toHaveAttribute("maxlength", "1");
    });
  });

  it("displays digits according to value prop", () => {
    render(<OtpInput value="123" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs[0].value).toBe("1");
    expect(inputs[1].value).toBe("2");
    expect(inputs[2].value).toBe("3");
    expect(inputs[3].value).toBe("");
  });

  it("typing a digit calls onChange and advances focus to the next input box", () => {
    const handleChange = vi.fn();
    render(<OtpInput value="" onChange={handleChange} />);
    const inputs = screen.getAllByRole("textbox");

    inputs[0].focus();
    fireEvent.change(inputs[0], { target: { value: "5" } });

    expect(handleChange).toHaveBeenCalledWith("5");
    expect(document.activeElement).toBe(inputs[1]);
  });

  it("strips non-digit characters when typed", () => {
    const handleChange = vi.fn();
    render(<OtpInput value="" onChange={handleChange} />);
    const inputs = screen.getAllByRole("textbox");

    fireEvent.change(inputs[0], { target: { value: "a" } });
    expect(handleChange).toHaveBeenCalledWith("");
  });

  it("pressing Backspace on an empty box moves focus to the previous input box", () => {
    render(<OtpInput value="1" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox");

    inputs[1].focus();
    fireEvent.keyDown(inputs[1], { key: "Backspace" });

    expect(document.activeElement).toBe(inputs[0]);
  });

  it("pasting a string strips non-digits, fills code, and advances focus", () => {
    const handleChange = vi.fn();
    render(<OtpInput value="" onChange={handleChange} />);
    const inputs = screen.getAllByRole("textbox");

    fireEvent.paste(inputs[0], {
      clipboardData: {
        getData: (format: string) => (format === "text" ? "abc-123-456-def" : ""),
      },
    });

    expect(handleChange).toHaveBeenCalledWith("123456");
    expect(document.activeElement).toBe(inputs[5]);
  });

  it("disables all inputs when disabled prop is true", () => {
    render(<OtpInput value="123456" onChange={vi.fn()} disabled />);
    const inputs = screen.getAllByRole("textbox");
    inputs.forEach((input) => {
      expect(input).toBeDisabled();
    });
  });
});
