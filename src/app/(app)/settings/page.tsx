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
        description="Environments are per project: open a project and use its Settings tab. AI keys arrive with T-29."
      />
    </>
  );
}
