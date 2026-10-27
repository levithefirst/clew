"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Fades a section in once when it scrolls into view. Reduced-motion users see it immediately (CSS). */
export function Reveal({ children, className, as: Tag = "div", delay = 0 }: { children: React.ReactNode; className?: string; as?: "div" | "section" | "li"; delay?: number }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    // @ts-expect-error polymorphic ref
    <Tag ref={ref} data-shown={shown} style={delay ? { transitionDelay: `${delay}ms` } : undefined} className={cn("reveal", className)}>
      {children}
    </Tag>
  );
}
