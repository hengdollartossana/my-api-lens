"use client";

import { useQuery } from "@tanstack/react-query";
import { Folder, type LucideIcon, Play, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { EnvBadge } from "@/components/badges";
import { useEnvironmentSelection } from "@/components/environments/use-environment-selection";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { EnvironmentRecord } from "@/db/environments";
import { isActive, NAV_ITEMS, projectIdFromPath } from "@/lib/ui-tokens";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { folder: Folder, play: Play, settings: Settings };

const selectClass =
  "h-8 rounded-md border border-zinc-300 bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary dark:border-zinc-800";

const isUuid = (s: string | null): s is string => !!s && /^[0-9a-f-]{36}$/i.test(s);

function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const pathProject = projectIdFromPath(pathname);
  const projectId = isUuid(pathProject) ? pathProject : null;

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("projects");
      return (await res.json()).projects;
    },
  });
  const envs = useQuery({
    queryKey: ["environments", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<EnvironmentRecord[]> => {
      const res = await fetch(`/api/projects/${projectId}/environments`);
      if (!res.ok) throw new Error("environments");
      return (await res.json()).environments;
    },
  });
  const [env, selectEnv] = useEnvironmentSelection(projectId, envs.data ?? []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
      <select
        aria-label="Project"
        className={cn(selectClass, "max-w-40")}
        value={projectId ?? ""}
        onChange={(e) => router.push(e.target.value ? `/projects/${e.target.value}` : "/projects")}
      >
        <option value="">All projects</option>
        {projects.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {projectId ? (
        envs.data && envs.data.length > 0 ? (
          <>
            <select
              aria-label="Environment"
              className={cn(
                selectClass,
                "max-w-32",
                env?.isProd && "border-red-500/60 text-red-600 dark:text-red-400",
              )}
              value={env?.id ?? ""}
              onChange={(e) => selectEnv(e.target.value)}
            >
              {envs.data.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.isProd ? " (prod)" : ""}
                </option>
              ))}
            </select>
            <EnvBadge isProd={!!env?.isProd} />
          </>
        ) : envs.isSuccess ? (
          <Link
            href={`/projects/${projectId}/settings`}
            className="text-xs text-primary hover:underline"
          >
            Add an environment
          </Link>
        ) : null
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
