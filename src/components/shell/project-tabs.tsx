"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PROJECT_TABS } from "@/lib/ui-tokens";
import { cn } from "@/lib/utils";

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
      {PROJECT_TABS.map((tab) => {
        const href = `${base}${tab.suffix}`;
        // "Modules" also covers the module and endpoint detail pages beneath it.
        const active =
          tab.suffix === ""
            ? pathname === base ||
              pathname.startsWith(`${base}/modules`) ||
              pathname.startsWith(`${base}/endpoints`)
            : pathname.startsWith(href);
        return (
          <Link
            key={tab.suffix}
            href={href}
            role="tab"
            aria-selected={active}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-zinc-500 hover:text-foreground dark:text-zinc-400",
              active && "border-primary text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
