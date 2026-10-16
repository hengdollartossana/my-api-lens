import { Settings } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Environments, auth recipes and AI keys." />
      <EmptyState
        icon={Settings}
        title="Nothing to configure yet"
        description="Environment and auth settings arrive with T-13 and T-16."
      />
    </>
  );
}
