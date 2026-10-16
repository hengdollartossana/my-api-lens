import { describe, expect, it } from "vitest";
import {
  assertAllowedTarget,
  isMetadataIp,
  isPrivateIp,
  type Resolver,
  SsrfError,
  type SsrfOptions,
} from "./ssrf";

const dns =
  (map: Record<string, string[]>): Resolver =>
  async (h) => {
    const r = map[h];
    if (!r) throw new Error("ENOTFOUND");
    return r;
  };

const opts: SsrfOptions = {
  appPort: 3000,
  resolve: dns({ "api.example.test": ["93.184.216.34"] }),
};
const run = (target: string, base: string, o: SsrfOptions = {}) =>
  assertAllowedTarget(target, base, { ...opts, ...o });
const codeOf = async (p: Promise<unknown>) => {
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(SsrfError);
  return (e as SsrfError).code;
};

describe("protocol and origin", () => {
  it("allows http and https on the same origin", async () => {
    const r = await run("https://api.example.test/v1/x?y=1", "https://api.example.test");
    expect(r.url.pathname).toBe("/v1/x");
    expect(r.addresses).toEqual(["93.184.216.34"]);
  });

  it.each(["file:///etc/passwd", "ftp://api.example.test/x", "gopher://api.example.test"])(
    "rejects %s",
    async (t) => {
      expect(await codeOf(run(t, "https://api.example.test"))).toBe("BAD_PROTOCOL");
    },
  );

  it.each([
    ["https://other.example.test/x", "different host"],
    ["http://api.example.test/x", "different scheme"],
    ["https://api.example.test:8443/x", "different port"],
    ["https://api.example.test@evil.test/x", "userinfo trick"],
  ])("rejects %s (%s)", async (t) => {
    expect(await codeOf(run(t, "https://api.example.test"))).toBe("ORIGIN_MISMATCH");
  });

  it("rejects garbage", async () => {
    expect(await codeOf(run("not a url", "https://api.example.test"))).toBe("INVALID_URL");
    expect(await codeOf(run("https://api.example.test", "nope"))).toBe("INVALID_URL");
  });
});

describe("cloud metadata", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://[fd00:ec2::254]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://2852039166/", // decimal form of 169.254.169.254
    "http://0xa9fea9fe/",
  ])("blocks %s even when the env points at it", async (t) => {
    expect(await codeOf(run(t, t))).toBe("METADATA_BLOCKED");
    expect(await codeOf(run(t, t, { allowPrivateTargets: true }))).toBe("METADATA_BLOCKED");
  });

  it("blocks DNS names that resolve to a metadata IP", async () => {
    for (const ip of ["169.254.169.254", "fd00:ec2::254", "::ffff:169.254.169.254"]) {
      const resolve = dns({ "rebind.example.test": ["93.184.216.34", ip] });
      expect(
        await codeOf(run("http://rebind.example.test/", "http://rebind.example.test", { resolve })),
      ).toBe("METADATA_BLOCKED");
    }
  });

  it("classifies addresses", () => {
    expect(isMetadataIp("169.254.169.254")).toBe(true);
    expect(isMetadataIp("169.254.169.253")).toBe(false);
    expect(isMetadataIp("fd00:ec2::254")).toBe(true);
    expect(isMetadataIp("fd00:ec2::255")).toBe(false);
  });
});

describe("app self-protection", () => {
  it.each([
    "http://localhost:3000/api/x",
    "http://127.0.0.1:3000/",
    "http://[::1]:3000/",
    "http://0.0.0.0:3000/",
  ])("blocks %s", async (t) => {
    expect(await codeOf(run(t, t))).toBe("SELF_BLOCKED");
  });

  it("blocks extra app hostnames and names resolving to loopback on the app port", async () => {
    const resolve = dns({ "app.local": ["127.0.0.1"], "mac.lan": ["192.168.1.5"] });
    expect(await codeOf(run("http://app.local:3000/", "http://app.local:3000", { resolve }))).toBe(
      "SELF_BLOCKED",
    );
    expect(
      await codeOf(
        run("http://mac.lan:3000/", "http://mac.lan:3000", { resolve, appHosts: ["mac.lan"] }),
      ),
    ).toBe("SELF_BLOCKED");
  });

  it("allows other local ports and the same port on a remote host", async () => {
    await expect(run("http://localhost:4010/api", "http://localhost:4010")).resolves.toBeDefined();
    const resolve = dns({ "api.example.test": ["93.184.216.34"] });
    await expect(
      run("http://api.example.test:3000/", "http://api.example.test:3000", { resolve }),
    ).resolves.toBeDefined();
  });

  it("reads the app port from APP_PORT when not passed", async () => {
    process.env.APP_PORT = "3999";
    try {
      expect(
        await codeOf(
          assertAllowedTarget("http://localhost:3999/", "http://localhost:3999", {
            resolve: dns({}),
          }),
        ),
      ).toBe("SELF_BLOCKED");
    } finally {
      delete process.env.APP_PORT;
    }
  });
});

describe("allowPrivateTargets", () => {
  const priv = [
    "http://localhost:4010/",
    "http://127.0.0.1:4010/",
    "http://10.1.2.3/",
    "http://192.168.0.9/",
    "http://172.20.0.1/",
    "http://[fd12::1]/",
    "http://[fe80::1]/",
    "http://100.64.0.1/",
  ];

  it.each(priv)("allows %s by default", async (t) => {
    await expect(run(t, t)).resolves.toBeDefined();
  });

  it.each(priv)("blocks %s when disabled", async (t) => {
    expect(await codeOf(run(t, t, { allowPrivateTargets: false }))).toBe("PRIVATE_BLOCKED");
  });

  it("blocks names that resolve to private IPs when disabled", async () => {
    const resolve = dns({ "internal.example.test": ["10.0.0.5"] });
    expect(
      await codeOf(
        run("http://internal.example.test/", "http://internal.example.test", {
          resolve,
          allowPrivateTargets: false,
        }),
      ),
    ).toBe("PRIVATE_BLOCKED");
  });

  it("still allows public targets when disabled", async () => {
    await expect(
      run("https://api.example.test/", "https://api.example.test", { allowPrivateTargets: false }),
    ).resolves.toBeDefined();
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("fails closed when DNS does not resolve", async () => {
    expect(await codeOf(run("http://nope.example.test/", "http://nope.example.test"))).toBe(
      "DNS_FAILED",
    );
  });
});
