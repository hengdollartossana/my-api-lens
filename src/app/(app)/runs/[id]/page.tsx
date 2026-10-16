import Link from "next/link";
import { RunView } from "@/components/runs/run-view";
import { PageHeader } from "@/components/shell/page-header";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        title="Run"
        description="Live status and stored results."
        actions={
          <Link href="/runs" className="text-xs text-primary hover:underline">
            All runs
          </Link>
        }
      />
      <RunView runId={id} />
    </>
  );
}
