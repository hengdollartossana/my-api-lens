"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

/** Runtime errors inside the app shell: the sidebar stays, only the page is replaced. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorState digest={error.digest} onRetry={retry} />;
}
