import { type ReactNode, useEffect } from "react";
import { CircleAlert, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ToastContext,
  useToastState,
  type Toast,
  type ToastVariant,
} from "@/lib/use-toast";

const icons: Record<ToastVariant, typeof CircleAlert> = {
  error: CircleAlert,
  success: CheckCircle2,
  info: Info,
};

const variantStyles: Record<ToastVariant, string> = {
  error: "border-l-destructive",
  success: "border-l-green-500",
  info: "border-l-blue-500",
};

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const Icon = icons[toast.variant];

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-l-4 bg-background px-3 py-2 text-sm shadow-md",
        variantStyles[toast.variant],
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const state = useToastState();

  return (
    <ToastContext.Provider value={state}>
      {children}
      {state.toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {state.toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onRemove={state.removeToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
