import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MethodBadge } from "@/components/badges";
import { EndpointSender } from "@/components/endpoints/endpoint-sender";
import { PageHeader } from "@/components/shell/page-header";
import { getEndpointDetail } from "@/db/endpoints";
import { listEnvironments } from "@/db/environments";
import { initialInput, type ParamDoc } from "@/lib/endpoint-input";

export const dynamic = "force-dynamic";

export default async function EndpointPage({
  params,
}: {
  params: Promise<{ id: string; endpointId: string }>;
}) {
  const { id, endpointId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(endpointId).success) notFound();
  const endpoint = await getEndpointDetail(id, endpointId);
  if (!endpoint) notFound();
  const environments = await listEnvironments(id);
  const initial = initialInput(
    endpoint.parameters as ParamDoc[] | null,
    endpoint.requestBodySchema,
  );

  return (
    <>
      <PageHeader
        title={endpoint.path}
        description={endpoint.summary ?? endpoint.operationId ?? undefined}
        actions={<MethodBadge method={endpoint.method} />}
      />
      {endpoint.moduleId ? (
        <p className="-mt-2 mb-4 text-xs text-zinc-500">
          Module:{" "}
          <Link
            href={`/projects/${id}/modules/${endpoint.moduleId}`}
            className="text-primary hover:underline"
          >
            {endpoint.moduleName}
          </Link>
        </p>
      ) : null}
      <EndpointSender
        projectId={id}
        endpoint={{
          id: endpoint.id,
          method: endpoint.method,
          path: endpoint.path,
          isDestructive: endpoint.isDestructive,
          responseSchemas: endpoint.responseSchemas as Record<string, unknown> | null,
        }}
        environments={environments}
        initial={initial}
      />
    </>
  );
}
