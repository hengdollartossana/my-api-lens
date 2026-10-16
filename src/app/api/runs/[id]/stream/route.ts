import { z } from "zod";
import { isLive, type RunEvent, replayFromDb, subscribe } from "@/lib/run-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const frame = (e: RunEvent) => `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`;

/** Server-sent events: `result` per endpoint, `progress`, then `done` (or `error` before `done`). */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: "Invalid run id" } },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  // Not in memory (finished before a restart)? Rebuild from the database.
  const replay = isLive(id) ? undefined : await replayFromDb(id);
  if (replay === null) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Run not found" } },
      { status: 404 },
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      cleanup = close;
      const send = (e: RunEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(frame(e)));
        if (e.type === "done") close();
      };

      if (replay) {
        for (const e of replay) send(e);
        return;
      }
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      unsubscribe = subscribe(id, send);
      if (closed) unsubscribe?.();
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
