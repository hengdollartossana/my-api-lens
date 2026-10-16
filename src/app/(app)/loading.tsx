import { Skeleton } from "@/components/ui/skeleton";

/** Shown while any app page streams in: a title row and a list of rows. */
export default function AppLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
