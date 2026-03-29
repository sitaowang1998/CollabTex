import { useState, useCallback, useRef, useEffect } from "react";
import { ApiError } from "./api";

export type UseApiMutationOptions<TArgs extends unknown[], TResult> = {
  mutationFn: (...args: TArgs) => Promise<TResult>;
  onSuccess?: (result: TResult) => void;
  onError?: (error: unknown) => void;
};

export type UseApiMutationResult<TArgs extends unknown[], TResult> = {
  execute: (...args: TArgs) => Promise<TResult | undefined>;
  isSubmitting: boolean;
  error: string;
  fieldErrors: Readonly<Record<string, string>> | undefined;
  reset: () => void;
};

export function useApiMutation<TArgs extends unknown[] = [], TResult = void>({
  mutationFn,
  onSuccess,
  onError,
}: UseApiMutationOptions<TArgs, TResult>): UseApiMutationResult<
  TArgs,
  TResult
> {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>> | undefined
  >();
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  const mutationFnRef = useRef(mutationFn);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    mutationFnRef.current = mutationFn;
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (submittingRef.current) return undefined;
      submittingRef.current = true;
      setIsSubmitting(true);
      setError("");
      setFieldErrors(undefined);

      try {
        const result = await mutationFnRef.current(...args);
        onSuccessRef.current?.(result);
        if (!mountedRef.current) return undefined;
        return result;
      } catch (err) {
        if (!(err instanceof ApiError)) console.error("[useApiMutation]", err);
        onErrorRef.current?.(err);
        if (!mountedRef.current) return undefined;
        if (err instanceof ApiError) {
          setError(err.message);
          if (err.fields) setFieldErrors(err.fields);
        } else {
          setError(
            err instanceof Error ? err.message : "An unexpected error occurred",
          );
        }
        return undefined;
      } finally {
        submittingRef.current = false;
        if (mountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError("");
    setFieldErrors(undefined);
  }, []);

  return { execute, isSubmitting, error, fieldErrors, reset };
}
