import { notFound } from "next/navigation";
import { z } from "zod";
import { EnvironmentsManager } from "@/components/environments/environments-manager";
import { PageHeader } from "@/components/shell/page-header";
import { listEnvironments, serverSuggestions } from "@/db/environments";
import { getProject } from "@/db/projects";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const project = await getProject(id);
  if (!project) notFound();
  const [environments, suggestions] = await Promise.all([
    listEnvironments(id),
    serverSuggestions(id),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Environments and safety settings for ${project.name}.`}
      />
      <EnvironmentsManager projectId={id} environments={environments} suggestions={suggestions} />
    </>
  );
}
