import { GitCompare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function DiffPage() {
  return (
    <>
      <PageHeader
        title="Diff"
        description="Spec vs reality mismatches, grouped by module (T-21)."
      />
      <EmptyState
        icon={GitCompare}
        title="Nothing here yet"
        description="Spec vs reality mismatches, grouped by module (T-21)."
      />
    </>
  );
}
