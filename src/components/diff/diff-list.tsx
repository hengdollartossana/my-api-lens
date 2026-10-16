import { StatusBadge } from "@/components/badges";
import type { DiffItemJson } from "@/lib/run-types";

const KIND_LABELS: Record<string, string> = {
  undocumented_status: "Undocumented status",
  missing_required: "Missing required field",
  extra_field: "Extra field",
  type_mismatch: "Type mismatch",
  unexpected_null: "Unexpected null",
  enum_violation: "Enum violation",
  format_violation: "Format violation",
};

export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

const show = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v) ?? ""));

/** Differences between an actual response and the spec, one row each. */
export function DiffList({ items }: { items: DiffItemJson[] }) {
  if (items.length === 0) return <p className="text-xs text-zinc-500">Matches the spec.</p>;
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((i) => (
        <li
          key={`${i.kind}|${i.path}`}
          className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-xs"
        >
          <StatusBadge status={i.severity} />
          <span className="font-medium">{kindLabel(i.kind)}</span>
          <code className="font-mono text-zinc-600 dark:text-zinc-300">{i.path}</code>
          <span className="basis-full text-zinc-500">{i.message}</span>
          {i.expected !== undefined || i.actual !== undefined ? (
            <span className="basis-full font-mono text-[11px] text-zinc-500">
              {i.expected !== undefined ? <>expected {show(i.expected)}</> : null}
              {i.expected !== undefined && i.actual !== undefined ? " · " : null}
              {i.actual !== undefined ? <>actual {show(i.actual)}</> : null}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
