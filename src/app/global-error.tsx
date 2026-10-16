"use client";

/**
 * Last resort when the root layout itself fails. It renders its own document, so it carries its
 * own minimal dark styling (global CSS and the theme script are not available here).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div role="alert" style={{ textAlign: "center", maxWidth: 360, padding: 24 }}>
          <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>API Lens hit an unexpected error</h1>
          <p style={{ fontSize: 13, color: "#a1a1aa", margin: "0 0 16px" }}>
            Reload to try again. If it keeps happening, check the server log
            {error.digest ? ` (reference ${error.digest})` : ""}.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              background: "#22c55e",
              color: "#052e16",
              border: 0,
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
