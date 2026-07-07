export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4300";

export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export const usdExact = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Active company id from the (non-httpOnly) session cookie. Client-side only. */
export function getCompanyId(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)plumb_company=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/** fetch to the API that always sends the session cookie. */
export function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${API}${path}`, { ...init, credentials: "include" });
}

/** Palette values needed in JS (SVG ring, inline bar fills). Mirrors globals.css. */
export const C = {
  navy: "#0e2a47",
  green: "#157a5a",
  amber: "#b45309",
  red: "#b42318",
  orange: "#ea580c",
  line: "#dde3e9",
};

/** Score → color bucket for the health ring and component bars. */
export function scoreColor(score: number): string {
  if (score >= 80) return C.green;
  if (score >= 60) return C.amber;
  return C.red;
}
