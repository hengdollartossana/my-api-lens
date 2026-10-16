import Link from "next/link";
import { MethodBadge, StatusBadge, ViaBadge } from "@/components/badges";
import { PageHeader } from "@/components/shell/page-header";

const SAMPLE = [
  {
    id: "login",
    method: "POST",
    path: "/api/v1/auth/login",
    via: "path" as const,
    status: "ok" as const,
  },
  {
    id: "me",
    method: "GET",
    path: "/api/v1/auth/me",
    via: "path" as const,
    status: "warn" as const,
  },
  {
    id: "logout",
    method: "DELETE",
    path: "/api/v1/auth/session",
    via: "manual" as const,
    status: "skipped" as const,
  },
];

export default async function ModulePage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;
  return (
    <>
      <PageHeader
        title={`Module ${moduleId}`}
        description="Endpoints in this module (placeholder rows)."
      />
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <tbody>
            {SAMPLE.map((row) => (
              <tr
                key={row.id}
                className="border-b border-zinc-200 last:border-0 dark:border-zinc-800"
              >
                <td className="w-20 p-2">
                  <MethodBadge method={row.method} />
                </td>
                <td className="p-2 font-mono text-xs">
                  <Link href={`/projects/${id}/endpoints/${row.id}`} className="hover:underline">
                    {row.path}
                  </Link>
                </td>
                <td className="p-2">
                  <ViaBadge via={row.via} />
                </td>
                <td className="p-2 text-right">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
