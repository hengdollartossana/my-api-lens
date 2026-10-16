"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Status = "draft" | "needs_review" | "approved";

/**
 * Approve or revoke a module. Approval is blocked while its latest diffs have errors; the user can
 * then choose "Approve with known issues" explicitly.
 */
export function ApproveModule({
  projectId,
  moduleId,
  status,
}: {
  projectId: string;
  moduleId: string;
  status: Status;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/projects/${projectId}/modules/${moduleId}/approval`;

  async function send(method: "POST" | "DELETE", knownIssues = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify({ knownIssues }) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.error?.code === "HAS_ERRORS") {
        setBlocked(data.error.message);
        return;
      }
      if (!res.ok) {
        setError(data?.error?.message ?? `Request failed (HTTP ${res.status})`);
        return;
      }
      setBlocked(null);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "approved" ? (
        <Button size="sm" variant="outline" onClick={() => send("DELETE")} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Revoke approval
        </Button>
      ) : (
        <Button size="sm" onClick={() => send("POST")} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {status === "needs_review" ? "Re-approve" : "Approve"}
        </Button>
      )}
      {blocked ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-xs text-amber-600 dark:text-amber-400"
        >
          <span>{blocked}.</span>
          <Button size="sm" variant="outline" onClick={() => send("POST", true)} disabled={busy}>
            Approve with known issues
          </Button>
        </div>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-red-500">
          {error}
        </span>
      ) : null}
    </div>
  );
}
