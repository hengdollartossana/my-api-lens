import { Code } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function CodegenPage() {
  return (
    <>
      <PageHeader
        title="Codegen"
        description="Generated Flutter models, client and contract tests (T-28)."
      />
      <EmptyState
        icon={Code}
        title="Nothing here yet"
        description="Generated Flutter models, client and contract tests (T-28)."
      />
    </>
  );
}
