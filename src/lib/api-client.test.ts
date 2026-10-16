import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiJson, errorFromBody, messageOf } from "./api-client";

afterEach(() => vi.unstubAllGlobals());

describe("errorFromBody", () => {
  it("uses the server message and code", () => {
    const e = errorFromBody({ error: { code: "NOT_FOUND", message: "Run not found" } }, 404, "x");
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ message: "Run not found", status: 404, code: "NOT_FOUND" });
  });
  it("falls back when the body has no usable error", () => {
    for (const body of [null, {}, { error: {} }, { error: { message: "" } }, "oops"]) {
      expect(errorFromBody(body, 500, "Request failed").message).toBe("Request failed");
    }
  });
});

describe("apiJson", () => {
  it("returns the parsed body and sends JSON", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiJson("/api/x", { method: "POST", json: { a: 1 } })).toEqual({ ok: 1 });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("throws the server's message on a failed call", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: { code: "AI_DISABLED", message: "Add a key" } }, { status: 409 }),
    );
    await expect(apiJson("/api/x")).rejects.toMatchObject({ message: "Add a key", status: 409 });
  });

  it("adds the HTTP status to the fallback when the body is not an error object", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 502 }));
    await expect(apiJson("/api/x", undefined, "Could not save")).rejects.toThrow(
      "Could not save (HTTP 502)",
    );
  });

  it("reports an unreachable server", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(apiJson("/api/x")).rejects.toMatchObject({
      code: "NETWORK",
      message: "Could not reach the server",
    });
  });
});

describe("messageOf", () => {
  it("reads errors and falls back for anything else", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
    expect(messageOf("x", "fallback")).toBe("fallback");
  });
});
