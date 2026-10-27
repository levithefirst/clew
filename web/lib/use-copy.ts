"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "ok" | "err";

/** Clipboard write with a visible result: "ok" or "err" for a moment, then back to idle. */
export function useCopy(ms = 1600): [CopyState, (text: string) => Promise<void>] {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      let next: CopyState = "ok";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        next = "err";
      }
      setState(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), ms);
    },
    [ms],
  );
  return [state, copy];
}
