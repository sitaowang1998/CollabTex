import { CircleAlert, TriangleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const icons = {
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
} as const;

const variantStyles = {
  error: "bg-destructive/10 border-destructive/30 text-destructive",
  warning:
    "bg-yellow-50 border-yellow-300 text-yellow-800 dark:bg-yellow-950/30 dark:border-yellow-700 dark:text-yellow-200",
  info: "bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-200",
} as const;

type AlertVariant = keyof typeof icons;

type AlertBannerProps = {
  variant?: AlertVariant;
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
};

export function AlertBanner({
  variant = "error",
  message,
  onDismiss,
  onRetry,
  className,
}: AlertBannerProps) {
  const Icon = icons[variant];

  return (
    <div
      role="alert"
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-lg border-l-4 px-3 py-2 text-sm",
        variantStyles[variant],
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry && (
        <Button variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
