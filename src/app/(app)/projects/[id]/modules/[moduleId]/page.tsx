import { notFound } from "next/navigation";
import { z } from "zod";
import { StatusBadge, ViaBadge } from "@/components/badges";
import { AiGroupingPanel } from "@/components/modules/ai-grouping-panel";
import { ModuleEndpoints } from "@/components/modules/module-endpoints";
import { RenameModule } from "@/components/modules/rename-module";
import { RunModulePanel } from "@/components/runs/run-module-panel";
import { PageHeader } from "@/components/shell/page-header";
import { UNGROUPED } from "@/core/grouper";
import { aiEnabled } from "@/db/ai";
import { listEnvironments } from "@/db/environments";
import { getModule, listModules } from "@/db/modules";

export const dynamic = "force-dynamic";

export default async function ModulePage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(moduleId).success) notFound();
  const found = await getModule(id, moduleId);
  if (!found) notFound();
  const { module: mod, endpoints } = found;
  const [environments, modules] = await Promise.all([listEnvironments(id), listModules(id)]);
  const destructive = endpoints.filter((e) => e.isDestructive).length;

  return (
    <>
      <PageHeader
        title={mod.name}
        description={`${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-2">
            <ViaBadge via={mod.via} />
            <StatusBadge status={mod.status} />
            <RenameModule projectId={id} moduleId={moduleId} name={mod.name} />
          </div>
        }
      />

      {mod.name === UNGROUPED && endpoints.length > 0 ? (
        <AiGroupingPanel projectId={id} aiEnabled={await aiEnabled()} />
      ) : null}

      <div className="mb-6">
        <RunModulePanel
          projectId={id}
          moduleId={moduleId}
          environments={environments}
          destructiveCount={destructive}
          endpointCount={endpoints.length}
        />
      </div>

      <ModuleEndpoints projectId={id} moduleId={moduleId} endpoints={endpoints} modules={modules} />
    </>
  );
}
