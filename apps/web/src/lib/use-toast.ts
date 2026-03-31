import { createContext, useContext, useCallback, useState } from "react";

export type ToastVariant = "error" | "success" | "info";

export type Toast = {
  id: string;
  variant: ToastVariant;
  message: string;
  duration: number;
};

export type ToastInput = {
  message: string;
  variant?: ToastVariant;
  duration?: number;
};

export type ToastContextValue = {
  toasts: Toast[];
  addToast: (input: ToastInput) => void;
  removeToast: (id: string) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function useToastState(): ToastContextValue {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((input: ToastInput) => {
    const id = String(++nextId);
    const toast: Toast = {
      id,
      variant: input.variant ?? "error",
      message: input.message,
      duration: input.duration ?? 5000,
    };
    setToasts((prev) => [...prev, toast]);
  }, []);

  return { toasts, addToast, removeToast };
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
