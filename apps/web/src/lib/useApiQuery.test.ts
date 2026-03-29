import { renderHook, act, waitFor } from "@testing-library/react";
import { useApiQuery } from "./useApiQuery";
import { ApiError } from "./api";

describe("useApiQuery", () => {
  it("fetches data on mount and sets loading states", async () => {
    const queryFn = vi.fn().mockResolvedValue("result");

    const { result } = renderHook(() =>
      useApiQuery({ queryFn, deps: [], initialData: null }),
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBe("result");
    expect(result.current.error).toBe("");
  });

  it("passes AbortSignal to queryFn", async () => {
    const queryFn = vi.fn().mockResolvedValue("ok");

    renderHook(() => useApiQuery({ queryFn, deps: [], initialData: null }));

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    expect(queryFn.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("sets error from ApiError", async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValue(new ApiError(500, "Server error"));

    const { result } = renderHook(() =>
      useApiQuery({ queryFn, deps: [], initialData: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Server error");
    expect(result.current.data).toBeNull();
  });

  it("sets error from generic Error", async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error("network fail"));

    const { result } = renderHook(() =>
      useApiQuery({ queryFn, deps: [], initialData: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("network fail");
  });

  it("refetches when deps change", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    const { result, rerender } = renderHook(
      ({ id }) => useApiQuery({ queryFn, deps: [id], initialData: null }),
      { initialProps: { id: 1 } },
    );

    await waitFor(() => expect(result.current.data).toBe("first"));

    rerender({ id: 2 });

    await waitFor(() => expect(result.current.data).toBe("second"));
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("aborts previous request on dep change", async () => {
    const capturedSignals: AbortSignal[] = [];
    const queryFn = vi.fn().mockImplementation((signal: AbortSignal) => {
      capturedSignals.push(signal);
      return new Promise((resolve) => setTimeout(() => resolve("done"), 100));
    });

    const { rerender } = renderHook(
      ({ id }) => useApiQuery({ queryFn, deps: [id], initialData: null }),
      { initialProps: { id: 1 } },
    );

    rerender({ id: 2 });

    expect(capturedSignals[0].aborted).toBe(true);
  });

  it("aborts on unmount", async () => {
    let capturedSignal: AbortSignal | null = null;
    const queryFn = vi.fn().mockImplementation((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise((resolve) => setTimeout(() => resolve("done"), 100));
    });

    const { unmount } = renderHook(() =>
      useApiQuery({ queryFn, deps: [], initialData: null }),
    );

    unmount();
    expect(capturedSignal!.aborted).toBe(true);
  });

  it("does not fetch when enabled is false", async () => {
    const queryFn = vi.fn().mockResolvedValue("data");

    const { result } = renderHook(() =>
      useApiQuery({
        queryFn,
        deps: [],
        initialData: null,
        enabled: false,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(queryFn).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("fetches when enabled changes from false to true", async () => {
    const queryFn = vi.fn().mockResolvedValue("fetched");

    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useApiQuery({ queryFn, deps: [], initialData: null, enabled }),
      { initialProps: { enabled: false } },
    );

    expect(queryFn).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.data).toBe("fetched"));
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("refetch() triggers a new fetch", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    const { result } = renderHook(() =>
      useApiQuery({ queryFn, deps: [], initialData: null }),
    );

    await waitFor(() => expect(result.current.data).toBe("first"));

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.data).toBe("second"));
  });

  it("setData updates data directly", async () => {
    const queryFn = vi.fn().mockResolvedValue("initial");

    const { result } = renderHook(() =>
      useApiQuery<string | null>({ queryFn, deps: [], initialData: null }),
    );

    await waitFor(() => expect(result.current.data).toBe("initial"));

    act(() => {
      result.current.setData("manually-set");
    });

    expect(result.current.data).toBe("manually-set");
  });

  it("clears error on successful refetch", async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "fail"))
      .mockResolvedValueOnce("success");

    const { result } = renderHook(() =>
      useApiQuery({ queryFn, deps: [], initialData: null }),
    );

    await waitFor(() => expect(result.current.error).toBe("fail"));

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.data).toBe("success"));
    expect(result.current.error).toBe("");
  });

  it("sets fallback error for non-Error thrown values", async () => {
    const queryFn = vi.fn().mockRejectedValue("string-error");

    const { result } = renderHook(() =>
      useApiQuery({ queryFn, deps: [], initialData: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("An unexpected error occurred");
  });

  it("resets data to initialData when deps change", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("second"), 50)),
      );

    const { result, rerender } = renderHook(
      ({ id }) => useApiQuery({ queryFn, deps: [id], initialData: "empty" }),
      { initialProps: { id: 1 } },
    );

    await waitFor(() => expect(result.current.data).toBe("first"));

    rerender({ id: 2 });

    // Data should reset to initialData immediately, before new fetch completes
    expect(result.current.data).toBe("empty");

    await waitFor(() => expect(result.current.data).toBe("second"));
  });

  it("clears error when enabled becomes false", async () => {
    const queryFn = vi.fn().mockRejectedValue(new ApiError(500, "fail"));

    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useApiQuery({ queryFn, deps: [], initialData: null, enabled }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.error).toBe("fail"));

    rerender({ enabled: false });

    expect(result.current.error).toBe("");
  });

  it("does not reset data on manual refetch()", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("second"), 50)),
      );

    const { result } = renderHook(() =>
      useApiQuery({ queryFn, deps: [], initialData: "empty" }),
    );

    await waitFor(() => expect(result.current.data).toBe("first"));

    act(() => {
      result.current.refetch();
    });

    // Data should NOT reset to initialData on manual refetch
    expect(result.current.data).toBe("first");

    await waitFor(() => expect(result.current.data).toBe("second"));
  });
});
