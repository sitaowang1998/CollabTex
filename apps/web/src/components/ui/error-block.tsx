import type { ReactNode } from "react";
import {
  WifiOff,
  LogIn,
  FileQuestion,
  ShieldX,
  ServerCrash,
  CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const iconMap = {
  network: WifiOff,
  auth: LogIn,
  "not-found": FileQuestion,
  forbidden: ShieldX,
  server: ServerCrash,
  generic: CircleAlert,
} as const;

export type ErrorBlockIcon = keyof typeof iconMap;

type ErrorBlockProps = {
  title?: string;
  message: string;
  icon?: ErrorBlockIcon;
  onRetry?: () => void;
  retryLabel?: string;
  actions?: ReactNode;
  className?: string;
};

export function ErrorBlock({
  title = "Something went wrong",
  message,
  icon = "generic",
  onRetry,
  retryLabel = "Retry",
  actions,
  className,
}: ErrorBlockProps) {
  const Icon = iconMap[icon];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-6 text-center",
        className,
      )}
    >
      <Icon className="size-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground" role="alert">
        {message}
      </p>
      {(onRetry || actions) && (
        <div className="flex gap-2">
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
