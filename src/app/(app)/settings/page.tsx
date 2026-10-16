import { AiSettings } from "@/components/settings/ai-settings";
import { PageHeader } from "@/components/shell/page-header";
import { getAiSettings } from "@/db/ai";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ai = await getAiSettings();
  return (
    <>
      <PageHeader
        title="Settings"
        description="AI is optional. Environments and auth recipes are per project: open a project and use its Settings tab."
      />
      <AiSettings initial={ai} />
    </>
  );
}
