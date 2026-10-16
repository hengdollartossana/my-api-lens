import { ProjectTabs } from "@/components/shell/project-tabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <ProjectTabs projectId={id} />
      {children}
    </>
  );
}
