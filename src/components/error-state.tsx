"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

/** Fallback UI for error boundaries: what happened, how to retry, where to go instead. */
export function ErrorState({
  title = "Something went wrong",
  message = "An unexpected error stopped this page from loading.",
  digest,
  onRetry,
  homeHref = "/projects",
}: {
  title?: string;
  message?: string;
  digest?: string;
  onRetry?: () => void;
  homeHref?: string;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-lg border border-dashed border-red-500/40 px-6 py-12 text-center"
    >
      <TriangleAlert className="h-8 w-8 text-red-500" aria-hidden />
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{message}</p>
      {digest ? <p className="font-mono text-[11px] text-zinc-500">Reference: {digest}</p> : null}
      <div className="mt-2 flex gap-2">
        {onRetry ? (
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Link href={homeHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to projects
        </Link>
      </div>
    </div>
  );
}
