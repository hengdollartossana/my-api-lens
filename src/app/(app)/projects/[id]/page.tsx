import { Boxes } from "lucide-react";
import Link from "next/link";
import { StatusBadge, ViaBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title={`Project ${id}`} description="Module overview (placeholder)." />
      <Link
        href={`/projects/${id}/modules/auth`}
        className="mb-4 flex items-center gap-2 rounded-lg border border-zinc-200 p-3 text-sm hover:border-primary dark:border-zinc-800"
      >
        <span className="font-medium">Auth</span>
        <ViaBadge via="path" />
        <StatusBadge status="draft" />
      </Link>
      <EmptyState
        icon={Boxes}
        title="No modules yet"
        description="Modules appear here after a spec is imported (T-10, T-11)."
      />
    </>
  );
}
