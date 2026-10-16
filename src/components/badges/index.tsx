import { methodClass, type StatusKey, statusStyle, type ViaKey, viaLabel } from "@/lib/ui-tokens";
import { cn } from "@/lib/utils";

const pill = "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4";

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span className={cn(pill, "font-mono uppercase tracking-wide", methodClass(method), className)}>
      {method.toUpperCase()}
    </span>
  );
}

/** Module approval state, run state or result severity. */
export function StatusBadge({ status, className }: { status: StatusKey; className?: string }) {
  const { label, className: tone } = statusStyle(status);
  return <span className={cn(pill, tone, className)}>{label}</span>;
}

/** How an endpoint ended up in its module (tag, path, operationId, auth, AI, manual). */
export function ViaBadge({ via, className }: { via: ViaKey; className?: string }) {
  return (
    <span
      className={cn(
        pill,
        "border border-zinc-500/30 bg-transparent font-mono text-zinc-500 dark:text-zinc-400",
        className,
      )}
      title="How this was grouped"
    >
      {viaLabel(via)}
    </span>
  );
}
