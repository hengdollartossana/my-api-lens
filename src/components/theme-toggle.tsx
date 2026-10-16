"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "apilens-theme";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    try {
      localStorage.setItem(STORAGE_KEY, nextDark ? "dark" : "light");
    } catch {
      // storage unavailable (private mode): the choice just is not remembered
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
      type="button"
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-zinc-400 hover:text-zinc-100" />
      ) : (
        <Moon className="h-4 w-4 text-zinc-600 hover:text-zinc-900" />
      )}
    </Button>
  );
}
