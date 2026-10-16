import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-800",
        className,
      )}
    >
      {Icon ? <Icon className="h-8 w-8 text-zinc-400" aria-hidden /> : null}
      <h2 className="text-sm font-medium">{title}</h2>
      {description ? (
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
