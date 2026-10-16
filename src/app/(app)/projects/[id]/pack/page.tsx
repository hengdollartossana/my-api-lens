import { notFound } from "next/navigation";
import { z } from "zod";
import { PackBuilder } from "@/components/pack/pack-builder";
import { PageHeader } from "@/components/shell/page-header";
import { listModules } from "@/db/modules";

export const dynamic = "force-dynamic";

export default async function PackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const modules = await listModules(id);
  return (
    <>
      <PageHeader
        title="Context pack"
        description="Choose modules and copy a low-token context pack for an AI assistant."
      />
      <PackBuilder projectId={id} modules={modules} />
    </>
  );
}
