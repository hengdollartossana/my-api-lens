import { Play } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RunsTable } from "@/components/runs/runs-table";
import { PageHeader } from "@/components/shell/page-header";

export default function RunsPage() {
  return (
    <>
      <PageHeader title="Runs" description="History of module runs across projects." />
      <RunsTable
        empty={
          <EmptyState
            icon={Play}
            title="No runs yet"
            description="Open a module and press Run module to see live results and history here."
          />
        }
      />
    </>
  );
}
