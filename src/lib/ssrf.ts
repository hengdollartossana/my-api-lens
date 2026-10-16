import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type SsrfErrorCode =
  | "INVALID_URL"
  | "BAD_PROTOCOL"
  | "ORIGIN_MISMATCH"
  | "DNS_FAILED"
  | "METADATA_BLOCKED"
  | "SELF_BLOCKED"
  | "PRIVATE_BLOCKED";

export class SsrfError extends Error {
  constructor(
    readonly code: SsrfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;

export interface SsrfOptions {
  /** Allow localhost / private ranges. Default true (dev tool hitting local APIs). */
  allowPrivateTargets?: boolean;
  /** The app's own port, never a valid target on a local host. Default: APP_PORT env. */
  appPort?: number;
  /** Extra hostnames that point at this app. */
  appHosts?: string[];
  /** DNS resolver, injectable for tests. */
  resolve?: Resolver;
}

export interface AllowedTarget {
  url: URL;
  /** Addresses the host resolved to, so callers can connect to a vetted IP. */
  addresses: string[];
}

const METADATA_V4 = [169, 254, 169, 254];
// fd00:ec2::254
const METADATA_V6 = [0xfd, 0x00, 0x0e, 0xc2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0x54];
const LOCAL_NAMES = new Set(["localhost", "0.0.0.0", "127.0.0.1", "::1", "::"]);

const defaultResolve: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

/** Parse an IPv4 or IPv6 literal to bytes (IPv4-mapped IPv6 collapses to its 4 IPv4 bytes). */
export function ipToBytes(ip: string): number[] | null {
  const family = isIP(ip);
  if (family === 4) return ip.split(".").map(Number);
  if (family !== 6) return null;

  let addr = ip.split("%")[0] as string;
  let tail: number[] = [];
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    tail = (v4[1] as string).split(".").map(Number);
    addr = `${addr.slice(0, -(v4[1] as string).length)}0:0`;
  }
  const [head, rest] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const groups =
    rest === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const bytes = groups.flatMap((g) => {
    const n = Number.parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
  if (tail.length) bytes.splice(12, 4, ...tail);
  const mapped =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return mapped ? bytes.slice(12) : bytes;
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function isMetadataIp(ip: string): boolean {
  const b = ipToBytes(ip);
  return !!b && (same(b, METADATA_V4) || same(b, METADATA_V6));
}

export function isLoopbackIp(ip: string): boolean {
  const b = ipToBytes(ip);
  if (!b) return false;
  if (b.length === 4) return b[0] === 127;
  return same(b, [...Array(15).fill(0), 1]);
}

/** Loopback, private, link-local, unspecified or carrier-grade NAT. */
export function isPrivateIp(ip: string): boolean {
  const b = ipToBytes(ip);
  if (!b) return false;
  if (b.length === 4) {
    const [a, c] = b as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && c === 254) ||
      (a === 172 && c >= 16 && c <= 31) ||
      (a === 192 && c === 168) ||
      (a === 100 && c >= 64 && c <= 127)
    );
  }
  const first = b[0] as number;
  const second = b[1] as number;
  return (
    b.every((x) => x === 0) ||
    isLoopbackIp(ip) ||
    (first & 0xfe) === 0xfc || // fc00::/7 unique local
    (first === 0xfe && (second & 0xc0) === 0x80) // fe80::/10 link-local
  );
}

function effectivePort(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

/**
 * Throws SsrfError unless `target` may be called for an environment whose base URL is `envBaseUrl`.
 * Rules: http/https only; same origin as the env base URL; cloud metadata IPs always blocked
 * (including DNS names that resolve to them); the app's own host/port blocked; private and
 * loopback targets only when allowPrivateTargets is true.
 */
export async function assertAllowedTarget(
  target: string,
  envBaseUrl: string,
  options: SsrfOptions = {},
): Promise<AllowedTarget> {
  const allowPrivate = options.allowPrivateTargets ?? true;
  const resolve = options.resolve ?? defaultResolve;

  let url: URL;
  let base: URL;
  try {
    url = new URL(target);
    base = new URL(envBaseUrl);
  } catch {
    throw new SsrfError("INVALID_URL", "Target or environment base URL is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("BAD_PROTOCOL", `Protocol ${url.protocol} is not allowed`);
  }
  if (url.origin !== base.origin) {
    throw new SsrfError(
      "ORIGIN_MISMATCH",
      `Target origin ${url.origin} does not match ${base.origin}`,
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else if (host === "localhost" || host.endsWith(".localhost")) {
    addresses = ["127.0.0.1"]; // always loopback, no DNS needed
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new SsrfError("DNS_FAILED", `Could not resolve ${host}`);
    }
    if (addresses.length === 0) throw new SsrfError("DNS_FAILED", `Could not resolve ${host}`);
  }

  if (addresses.some(isMetadataIp)) {
    throw new SsrfError("METADATA_BLOCKED", "Cloud metadata addresses are never allowed");
  }

  const appPort = options.appPort ?? (Number(process.env.APP_PORT) || undefined);
  if (appPort && effectivePort(url) === appPort) {
    const appHosts = new Set([
      ...LOCAL_NAMES,
      ...(options.appHosts ?? []).map((h) => h.toLowerCase()),
    ]);
    if (appHosts.has(host) || addresses.some(isLoopbackIp)) {
      throw new SsrfError("SELF_BLOCKED", "Target is this app's own host and port");
    }
  }

  if (!allowPrivate && (LOCAL_NAMES.has(host) || addresses.some(isPrivateIp))) {
    throw new SsrfError("PRIVATE_BLOCKED", "Private and local targets are disabled");
  }

  return { url, addresses };
}
