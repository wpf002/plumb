import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API } from "./ui";

// Server-component helpers. Forward the browser's cookies to the API so the
// session travels Next-server → API, and bounce to /login when unauthenticated.

export function activeCompanyId(): string {
  return cookies().get("plumb_company")?.value ?? "";
}

function cookieHeader(): string {
  return cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export async function apiGet(path: string) {
  const res = await fetch(`${API}${path}`, {
    cache: "no-store",
    headers: { cookie: cookieHeader() },
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
