import { MethodBadge } from "@/components/badges";
import { JsonViewer } from "@/components/json-viewer";
import { PageHeader } from "@/components/shell/page-header";

const SAMPLE_RESPONSE = {
  id: "u1",
  email: "ann@example.test",
  name: "Ann",
  address: { city: "Springfield" },
};

export default async function EndpointPage({
  params,
}: {
  params: Promise<{ id: string; endpointId: string }>;
}) {
  const { endpointId } = await params;
  return (
    <>
      <PageHeader
        title={`Endpoint ${endpointId}`}
        description="Request, response and diff for one endpoint (placeholder)."
        actions={<MethodBadge method="GET" />}
      />
      <h2 className="mb-2 text-sm font-medium">Sample response</h2>
      <JsonViewer value={SAMPLE_RESPONSE} />
    </>
  );
}
