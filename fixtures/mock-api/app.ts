import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const TOKEN = "mock-access-token";
const REFRESH = "mock-refresh-token";

const address = { line1: "1 Main St", city: "Springfield", zip: "12345" };
const money = (amount: number | string) => ({ amount, currency: "USD" });

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    return {};
  }
}

function authorized(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://mock");
  const method = req.method ?? "GET";
  const seg = url.pathname.split("/").filter(Boolean); // api, v1, ...
  if (seg[0] !== "api" || seg[1] !== "v1") return send(res, 404, { message: "not found" });
  const rest = seg.slice(2);

  // --- auth (public: login, refresh) ---
  if (rest[0] === "auth") {
    if (rest[1] === "login" && method === "POST") {
      const b = await readJson(req);
      if (b.username === "demo" && b.password === "demo") {
        return send(res, 200, { token: TOKEN, refreshToken: REFRESH });
      }
      return send(res, 401, { message: "bad credentials" });
    }
    if (rest[1] === "refresh" && method === "POST") {
      const b = await readJson(req);
      if (b.refreshToken === REFRESH)
        return send(res, 200, { token: TOKEN, refreshToken: REFRESH });
      return send(res, 401, { message: "bad refresh token" });
    }
    if (rest[1] === "me" && method === "GET") {
      if (!authorized(req)) return send(res, 401, { message: "unauthorized" });
      return send(res, 200, { id: "u1", email: "demo@example.test", name: "Demo", address });
    }
    return send(res, 404, { message: "not found" });
  }

  // --- protected: /api/v1/{tenant}/... ---
  if (!authorized(req)) return send(res, 401, { message: "unauthorized" });
  const [, resource, id] = rest;

  if (resource === "users") {
    if (!id && method === "GET") {
      // MISMATCH: second user is missing required `email`.
      return send(res, 200, [
        { id: "u1", email: "ann@example.test", name: "Ann", address },
        { id: "u2", name: "Bob" },
      ]);
    }
    if (!id && method === "POST") {
      const b = await readJson(req);
      // MISMATCH: undocumented 409 status.
      if (b.email === "taken@example.com")
        return send(res, 409, { message: "email already exists" });
      return send(res, 201, { id: "u3", email: b.email, name: b.name });
    }
    if (id && method === "GET") {
      if (id === "missing") return send(res, 404, { message: "not found" });
      // MISMATCH: extra field `internalNote` not in the spec.
      return send(res, 200, {
        id,
        email: "ann@example.test",
        name: "Ann",
        address,
        internalNote: "vip",
      });
    }
  }

  if (resource === "orders") {
    const lines = [{ sku: "SKU-1", quantity: 2, price: money(10) }];
    if (!id && method === "GET") {
      // MISMATCH: total.amount is a string, spec says number.
      return send(res, 200, [{ id: "o1", total: money("42.50"), shippingAddress: address, lines }]);
    }
    if (id && method === "GET") {
      if (id === "missing") return send(res, 404, { message: "not found" });
      // MISMATCH: shippingAddress is null, spec does not allow null.
      return send(res, 200, { id, total: money(20), shippingAddress: null, lines });
    }
    if (id && method === "DELETE") {
      if (id === "missing") return send(res, 404, { message: "not found" });
      return send(res, 204);
    }
  }

  return send(res, 404, { message: "not found" });
}

export function createMockServer(): Server {
  return createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { message: "mock error" }));
  });
}
