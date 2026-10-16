import { Skeleton } from "@/components/ui/skeleton";

/** Project screens: a title and a grid of cards (modules). */
export default function ProjectLoading() {
  return (
    <div role="status" aria-label="Loading project" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}
