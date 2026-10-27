import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 0x389a50…0d03 style truncation for hashes and addresses. */
export function short(hex: string, head = 6, tail = 4) {
  if (!hex || hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
