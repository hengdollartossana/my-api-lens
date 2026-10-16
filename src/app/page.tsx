import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-background text-foreground">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight">API Lens</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Authenticated workspace session active
        </p>
        <div className="mt-2">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
