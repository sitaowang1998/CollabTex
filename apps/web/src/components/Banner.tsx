import { cva } from "class-variance-authority";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "../lib/utils";

const bannerVariants = cva(
  "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm",
  {
    variants: {
      tone: {
        error: "border-red-200 bg-red-50 text-red-700 [&_svg]:text-red-500",
        success:
          "border-emerald-200 bg-emerald-50 text-emerald-700 [&_svg]:text-emerald-500",
      },
    },
  },
);

export function Banner({
  message,
  tone,
}: {
  message: string;
  tone: "error" | "success";
}) {
  return (
    <div className={cn(bannerVariants({ tone }))}>
      {tone === "error" ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <p className="leading-6">{message}</p>
    </div>
  );
}
