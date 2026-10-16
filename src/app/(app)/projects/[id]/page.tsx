import { Boxes } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { StatusBadge, ViaBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { ReimportDialog } from "@/components/projects/reimport-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { listModules } from "@/db/modules";
import { getProject } from "@/db/projects";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const project = await getProject(id);
  if (!project) notFound();
  const modules = await listModules(id);

  return (
    <>
      <PageHeader
        title={project.name}
        description={`${project.endpointCount} endpoints in ${project.moduleCount} modules`}
        actions={
          <ReimportDialog
            projectId={id}
            specSource={project.specSource}
            specUrl={project.specUrl}
          />
        }
      />
      {modules.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No modules"
          description="This project has no endpoints yet."
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <Link
              key={m.id}
              href={`/projects/${id}/modules/${m.id}`}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm hover:border-primary dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{m.name}</span>
                <span className="text-xs text-zinc-500">{m.endpointCount} endpoints</span>
              </div>
              <div className="flex gap-2">
                <ViaBadge via={m.via} />
                <StatusBadge status={m.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
