"use client";

import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function useIsDark() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Editable JSON field (CodeMirror 6). Validation is left to the caller. */
export function JsonEditor({
  value,
  onChange,
  maxHeight = "20rem",
  className,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  maxHeight?: string;
  className?: string;
  label: string;
}) {
  const dark = useIsDark();
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-800",
        className,
      )}
    >
      <CodeMirror
        value={value}
        extensions={[json()]}
        theme={dark ? "dark" : "light"}
        onChange={onChange}
        maxHeight={maxHeight}
        minHeight="8rem"
        basicSetup={{ lineNumbers: true, foldGutter: false }}
        className="text-xs"
      />
    </div>
  );
}
