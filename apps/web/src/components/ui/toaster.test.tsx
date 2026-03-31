import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "./toaster";
import { useToast } from "@/lib/use-toast";

function TestConsumer() {
  const { addToast } = useToast();
  return (
    <button
      onClick={() => addToast({ message: "Test toast", variant: "error" })}
    >
      Show Toast
    </button>
  );
}

describe("Toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows toast when addToast is called", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByText("Test toast")).toBeInTheDocument();
  });

  it("auto-dismisses toast after duration", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByText("Test toast")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryByText("Test toast")).not.toBeInTheDocument();
  });

  it("dismisses toast when dismiss button is clicked", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByText("Test toast")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Test toast")).not.toBeInTheDocument();
  });
});
