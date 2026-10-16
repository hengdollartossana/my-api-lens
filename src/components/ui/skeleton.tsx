import { cn } from "@/lib/utils";

/** A pulsing placeholder block for loading states. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800", className)}
    />
  );
}
