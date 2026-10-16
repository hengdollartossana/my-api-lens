import { notFound } from "next/navigation";
import { z } from "zod";
import { CodegenBuilder } from "@/components/codegen/codegen-builder";
import { PageHeader } from "@/components/shell/page-header";
import { listModules } from "@/db/modules";
import { getProject } from "@/db/projects";

export const dynamic = "force-dynamic";

export default async function CodegenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [project, modules] = await Promise.all([getProject(id), listModules(id)]);
  if (!project) notFound();
  return (
    <>
      <PageHeader
        title="Codegen"
        description="Generate Flutter models, clients, repositories and contract tests."
      />
      <CodegenBuilder projectId={id} projectName={project.name} modules={modules} />
    </>
  );
}
