"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="p-6">
      <ErrorState digest={error.digest} onRetry={retry} homeHref="/" />
    </main>
  );
}
