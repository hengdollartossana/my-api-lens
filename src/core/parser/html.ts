/**
 * People often paste the URL of an API docs page (Swagger UI, Redoc) instead of the spec itself.
 * Detect that, and find the spec URL the page loads.
 */

export function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(text.slice(0, 512));
}

/** Where Swagger UI (`url: '...'`) or Redoc (`spec-url="..."`) says the spec lives. */
const POINTERS = [
  /\bspec-url\s*=\s*["']([^"']+)["']/i,
  /\bSwaggerUIBundle\s*\(\s*\{[^}]*?\burl\s*:\s*["']([^"']+)["']/i,
  /\burl\s*:\s*["']([^"']+\.(?:json|ya?ml)(?:\?[^"']*)?)["']/i,
  /\burl\s*:\s*["'](\/[^"']*(?:openapi|swagger)[^"']*)["']/i,
];

/**
 * The spec URL a docs page points to, resolved against the page URL. Only same-origin results are
 * returned, so following it never reaches a host the caller did not already approve.
 */
export function discoverSpecUrl(html: string, pageUrl: string): string | null {
  for (const re of POINTERS) {
    const found = html.match(re)?.[1];
    if (!found) continue;
    try {
      const target = new URL(found, pageUrl);
      const page = new URL(pageUrl);
      if (target.origin === page.origin && target.href !== page.href) return target.href;
    } catch {
      // not a usable URL: try the next pattern
    }
  }
  return null;
}

export const NOT_A_SPEC_MESSAGE =
  "That is a web page, not an OpenAPI spec. Use the JSON or YAML URL instead (often /openapi.json, /swagger.json or /v3/api-docs).";
