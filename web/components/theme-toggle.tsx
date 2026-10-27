"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Header: one-click flip between dark and light. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = !mounted || resolvedTheme !== "light";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className={cn("inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-3 hover:bg-fill-hover hover:text-ink", className)}
    >
      {/* Both icons rendered; CSS picks by theme class so there's no hydration flicker. */}
      <Sun className="size-[17px] hidden dark:block" strokeWidth={1.75} />
      <Moon className="size-[17px] dark:hidden" strokeWidth={1.75} />
    </button>
  );
}

/** Footer: explicit system / light / dark choice. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const opts = [
    { id: "system", label: "System theme", Icon: Monitor },
    { id: "light", label: "Light theme", Icon: Sun },
    { id: "dark", label: "Dark theme", Icon: Moon },
  ] as const;
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex items-center gap-0.5 rounded-full border p-0.5">
      {opts.map(({ id, label, Icon }) => {
        const on = mounted && theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setTheme(id)}
            className={cn("inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-4 hover:text-ink", on && "bg-fill-hover text-ink")}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
