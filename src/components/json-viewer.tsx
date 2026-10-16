"use client";

import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Follows the `dark` class on <html>, which the theme toggle flips. */
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

/** Read-only JSON display. Pass a value (pretty-printed) or an already formatted string. */
export function JsonViewer({
  value,
  maxHeight = "24rem",
  className,
}: {
  value: unknown;
  maxHeight?: string;
  className?: string;
}) {
  const dark = useIsDark();
  const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-800",
        className,
      )}
    >
      <CodeMirror
        value={text}
        extensions={[json()]}
        theme={dark ? "dark" : "light"}
        editable={false}
        readOnly
        maxHeight={maxHeight}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
        className="text-xs"
      />
    </div>
  );
}
