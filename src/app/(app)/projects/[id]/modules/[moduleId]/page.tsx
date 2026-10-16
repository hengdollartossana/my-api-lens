import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MethodBadge, StatusBadge, ViaBadge } from "@/components/badges";
import { RunModulePanel } from "@/components/runs/run-module-panel";
import { PageHeader } from "@/components/shell/page-header";
import { listEnvironments } from "@/db/environments";
import { getModule } from "@/db/modules";

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
  const environments = await listEnvironments(id);
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
          </div>
        }
      />

      <div className="mb-6">
        <RunModulePanel
          projectId={id}
          moduleId={moduleId}
          environments={environments}
          destructiveCount={destructive}
          endpointCount={endpoints.length}
        />
      </div>

      <h2 className="mb-2 text-sm font-medium">Endpoints</h2>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <tbody>
            {endpoints.map((e) => (
              <tr
                key={e.id}
                className="border-b border-zinc-200 last:border-0 dark:border-zinc-800"
              >
                <td className="w-20 p-2">
                  <MethodBadge method={e.method} />
                </td>
                <td className="p-2 font-mono text-xs">
                  <Link href={`/projects/${id}/endpoints/${e.id}`} className="hover:underline">
                    {e.path}
                  </Link>
                </td>
                <td className="p-2 text-xs text-zinc-500">{e.summary}</td>
                <td className="p-2 text-right text-xs text-zinc-500">
                  {e.isDestructive ? "destructive" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
