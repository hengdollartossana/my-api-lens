import { Play } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function RunsPage() {
  return (
    <>
      <PageHeader title="Runs" description="History of module runs across projects." />
      <EmptyState
        icon={Play}
        title="No runs yet"
        description="Run a module to see live results and history here (T-19)."
      />
    </>
  );
}
