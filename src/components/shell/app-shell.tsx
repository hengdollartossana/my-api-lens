"use client";

import { Folder, type LucideIcon, Play, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  isActive,
  NAV_ITEMS,
  PLACEHOLDER_ENVIRONMENTS,
  PLACEHOLDER_PROJECTS,
  projectIdFromPath,
} from "@/lib/ui-tokens";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { folder: Folder, play: Play, settings: Settings };

const selectClass =
  "h-8 rounded-md border border-zinc-300 bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary dark:border-zinc-800";

function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const projectId = projectIdFromPath(pathname) ?? "";
  const [env, setEnv] = useState(PLACEHOLDER_ENVIRONMENTS[0]?.name ?? "");
  const isProd = PLACEHOLDER_ENVIRONMENTS.find((e) => e.name === env)?.isProd ?? false;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
      <select
        aria-label="Project"
        className={cn(selectClass, "max-w-40")}
        value={projectId}
        onChange={(e) => router.push(e.target.value ? `/projects/${e.target.value}` : "/projects")}
      >
        <option value="">All projects</option>
        {PLACEHOLDER_PROJECTS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Environment"
        className={cn(
          selectClass,
          "max-w-32",
          isProd && "border-red-500/60 text-red-600 dark:text-red-400",
        )}
        value={env}
        onChange={(e) => setEnv(e.target.value)}
      >
        {PLACEHOLDER_ENVIRONMENTS.map((e) => (
          <option key={e.name} value={e.name}>
            {e.name}
          </option>
        ))}
      </select>
      {isProd ? (
        <span className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-red-600 dark:text-red-400">
          prod
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <LogoutButton />
      </div>
    </header>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="flex w-14 shrink-0 flex-col gap-1 border-r border-zinc-200 p-2 dark:border-zinc-800 lg:w-52"
    >
      <Link href="/projects" className="mb-2 flex h-9 items-center gap-2 px-2 font-semibold">
        <span className="h-3 w-3 shrink-0 rounded-sm bg-primary" aria-hidden />
        <span className="hidden lg:inline">API Lens</span>
      </Link>
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.icon] as LucideIcon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md px-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-foreground dark:text-zinc-400 dark:hover:bg-zinc-900",
              active && "bg-zinc-100 font-medium text-foreground dark:bg-zinc-900",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden lg:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-w-0 flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}
