import { useState, useEffect, useCallback, useRef } from "react";
import { ApiError } from "./api";

export type UseApiQueryOptions<T> = {
  queryFn: (signal: AbortSignal) => Promise<T>;
  deps: unknown[];
  initialData: T;
  enabled?: boolean;
};

export type UseApiQueryResult<T> = {
  data: T;
  isLoading: boolean;
  error: string;
  refetch: () => void;
  setData: React.Dispatch<React.SetStateAction<T>>;
};

export function useApiQuery<T>({
  queryFn,
  deps,
  initialData,
  enabled = true,
}: UseApiQueryOptions<T>): UseApiQueryResult<T> {
  const [data, setData] = useState<T>(initialData);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const queryFnRef = useRef(queryFn);
  const initialDataRef = useRef(initialData);

  useEffect(() => {
    queryFnRef.current = queryFn;
    initialDataRef.current = initialData;
  });

  const refetch = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setIsLoading(true);
    setError("");

    queryFnRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (!(err instanceof ApiError)) console.error("[useApiQuery]", err);
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "An unexpected error occurred",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      setError("");
      return;
    }
    setData(initialDataRef.current);
    refetch();
    return () => {
      controllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refetch, ...deps]);

  return { data, isLoading, error, refetch, setData };
}
