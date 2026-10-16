import { NotFoundState } from "@/components/not-found-state";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md p-6">
      <NotFoundState href="/" label="Go home" />
    </main>
  );
}
