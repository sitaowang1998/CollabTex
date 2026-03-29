import { renderHook, act } from "@testing-library/react";
import { useApiMutation } from "./useApiMutation";
import { ApiError } from "./api";

describe("useApiMutation", () => {
  it("executes mutation and returns result", async () => {
    const mutationFn = vi.fn().mockResolvedValue({ id: 1 });
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useApiMutation({ mutationFn, onSuccess }),
    );

    expect(result.current.isSubmitting).toBe(false);

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.execute();
    });

    expect(returnValue).toEqual({ id: 1 });
    expect(onSuccess).toHaveBeenCalledWith({ id: 1 });
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("passes arguments to mutationFn", async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useApiMutation<[string, number], void>({ mutationFn }),
    );

    await act(async () => {
      await result.current.execute("hello", 42);
    });

    expect(mutationFn).toHaveBeenCalledWith("hello", 42);
  });

  it("sets error from ApiError", async () => {
    const mutationFn = vi
      .fn()
      .mockRejectedValue(new ApiError(400, "Bad request"));

    const { result } = renderHook(() => useApiMutation({ mutationFn }));

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.execute();
    });

    expect(returnValue).toBeUndefined();
    expect(result.current.error).toBe("Bad request");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("extracts fieldErrors from ApiError", async () => {
    const mutationFn = vi
      .fn()
      .mockRejectedValue(
        new ApiError(422, "Validation failed", { email: "Invalid email" }),
      );

    const { result } = renderHook(() => useApiMutation({ mutationFn }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.fieldErrors).toEqual({ email: "Invalid email" });
  });

  it("sets error from generic Error", async () => {
    const mutationFn = vi.fn().mockRejectedValue(new Error("network fail"));

    const { result } = renderHook(() => useApiMutation({ mutationFn }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe("network fail");
  });

  it("calls onError callback on failure", async () => {
    const error = new ApiError(500, "Server error");
    const mutationFn = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useApiMutation({ mutationFn, onError }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("sets isSubmitting during execution", async () => {
    let resolve: (v: void) => void;
    const mutationFn = vi
      .fn()
      .mockReturnValue(new Promise<void>((r) => (resolve = r)));

    const { result } = renderHook(() => useApiMutation({ mutationFn }));

    let executePromise: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute();
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolve!();
      await executePromise;
    });

    expect(result.current.isSubmitting).toBe(false);
  });

  it("reset() clears error and fieldErrors", async () => {
    const mutationFn = vi
      .fn()
      .mockRejectedValue(new ApiError(422, "fail", { name: "required" }));

    const { result } = renderHook(() => useApiMutation({ mutationFn }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe("fail");
    expect(result.current.fieldErrors).toEqual({ name: "required" });

    act(() => {
      result.current.reset();
    });

    expect(result.current.error).toBe("");
    expect(result.current.fieldErrors).toBeUndefined();
  });

  it("calls onSuccess but skips state updates after unmount", async () => {
    let resolve: (v: { id: number }) => void;
    const mutationFn = vi
      .fn()
      .mockReturnValue(new Promise<{ id: number }>((r) => (resolve = r)));
    const onSuccess = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result, unmount } = renderHook(() =>
      useApiMutation({ mutationFn, onSuccess }),
    );

    let executePromise: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute();
    });

    unmount();

    await act(async () => {
      resolve!({ id: 1 });
      await executePromise;
    });

    // onSuccess should still fire for global side effects (e.g., navigation)
    expect(onSuccess).toHaveBeenCalledWith({ id: 1 });
    consoleSpy.mockRestore();
  });

  it("sets fallback error for non-Error thrown values", async () => {
    const mutationFn = vi.fn().mockRejectedValue("string-error");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useApiMutation({ mutationFn }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe("An unexpected error occurred");
    consoleSpy.mockRestore();
  });

  it("clears previous error on new execute call", async () => {
    const mutationFn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(400, "first error"))
      .mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useApiMutation({ mutationFn }));

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBe("first error");

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBe("");
  });

  it("prevents concurrent execute calls", async () => {
    let resolve: (v: void) => void;
    const mutationFn = vi
      .fn()
      .mockReturnValue(new Promise<void>((r) => (resolve = r)));

    const { result } = renderHook(() => useApiMutation({ mutationFn }));

    let promise1: Promise<unknown>;
    act(() => {
      promise1 = result.current.execute();
    });

    // Second call while first is in flight
    let promise2Result: unknown;
    act(() => {
      promise2Result = result.current.execute();
    });

    // Second call should return undefined immediately
    expect(await promise2Result).toBeUndefined();
    expect(mutationFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve!();
      await promise1!;
    });
  });
});
