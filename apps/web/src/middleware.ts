import { NextResponse, type NextRequest } from "next/server";

// Route guard: no session cookie → send to /login. Cookie validity is enforced
// by the API (a stale cookie still 401s there, and the server components bounce
// back to /login). We don't force logged-in users off /login, to avoid loops.
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has("plumb_session");
  const isLogin = req.nextUrl.pathname === "/login";
  if (!hasSession && !isLogin) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
