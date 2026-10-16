import { FolderOpen } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { listProjects, type ProjectSummary } from "@/db/projects";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

async function load(): Promise<{ projects: ProjectSummary[]; error: string | null }> {
  try {
    return { projects: await listProjects(), error: null };
  } catch {
    return {
      projects: [],
      error: "Could not load projects. Is the database running (pnpm db:up)?",
    };
  }
}

export default async function ProjectsPage() {
  const { projects, error } = await load();
  return (
    <>
      <PageHeader
        title="Projects"
        description="Import a spec to start verifying an API."
        actions={<NewProjectDialog />}
      />
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}
      {projects.length === 0 && !error ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Use New project to import a Swagger/OpenAPI spec from a URL or a file."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="p-2 font-medium">Name</th>
                <th className="p-2 text-right font-medium">Endpoints</th>
                <th className="p-2 text-right font-medium">Modules</th>
                <th className="p-2 font-medium">Last imported</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-zinc-200 last:border-0 dark:border-zinc-800"
                >
                  <td className="p-2">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="max-w-xs truncate text-xs text-zinc-500">
                      {p.specSource === "url" ? p.specUrl : "Uploaded file"}
                    </div>
                  </td>
                  <td className="p-2 text-right tabular-nums">{p.endpointCount}</td>
                  <td className="p-2 text-right tabular-nums">{p.moduleCount}</td>
                  <td className="p-2 text-xs text-zinc-500">
                    {p.lastImportedAt ? fmt.format(p.lastImportedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
