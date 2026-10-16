import { Package } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function PackPage() {
  return (
    <>
      <PageHeader
        title="Context pack"
        description="Choose modules and copy a low-token context pack (T-25)."
      />
      <EmptyState
        icon={Package}
        title="Nothing here yet"
        description="Choose modules and copy a low-token context pack (T-25)."
      />
    </>
  );
}
