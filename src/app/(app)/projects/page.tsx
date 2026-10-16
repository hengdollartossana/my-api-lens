import { FolderOpen } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { PLACEHOLDER_PROJECTS } from "@/lib/ui-tokens";

export default function ProjectsPage() {
  return (
    <>
      <PageHeader title="Projects" description="Import a spec to start verifying an API." />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PLACEHOLDER_PROJECTS.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="rounded-lg border border-zinc-200 p-3 text-sm hover:border-primary dark:border-zinc-800"
          >
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-zinc-500">Placeholder data</div>
          </Link>
        ))}
      </div>
      <EmptyState
        icon={FolderOpen}
        title="No real projects yet"
        description="The import flow arrives in T-10. Until then this list shows placeholder data."
        action={
          <Link
            href="/projects/demo"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open demo project
          </Link>
        }
      />
    </>
  );
}
