import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";

/** Shared 404 body: what is missing and a way back. */
export function NotFoundState({ href = "/projects", label = "Back to projects" }) {
  return (
    <EmptyState
      icon={SearchX}
      title="Not found"
      description="This page does not exist, or the project, module or run was deleted."
      action={
        <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {label}
        </Link>
      }
    />
  );
}
