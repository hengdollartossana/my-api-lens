import { notFound } from "next/navigation";
import { z } from "zod";
import { DiffView } from "@/components/diff/diff-view";
import { PageHeader } from "@/components/shell/page-header";
import { listLatestDiffs } from "@/db/diffs";
import { listEnvironments } from "@/db/environments";

export const dynamic = "force-dynamic";

export default async function DiffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [rows, environments] = await Promise.all([listLatestDiffs(id), listEnvironments(id)]);
  return (
    <>
      <PageHeader
        title="Diff"
        description="How the real responses differ from the spec, from each endpoint's latest run."
      />
      <DiffView
        projectId={id}
        rows={rows}
        environments={environments.map((e) => ({ id: e.id, name: e.name, isProd: e.isProd }))}
      />
    </>
  );
}
