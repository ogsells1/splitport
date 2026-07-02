import { NextRequest, NextResponse } from "next/server";

// Host-based routing: the marketing landing lives on the root domain,
// the product lives on the app. subdomain (set NEXT_PUBLIC_APP_URL, e.g.
// https://app.bynsplit.com). On *.vercel.app (no subdomain support) both
// keep working from one host.

const APP_PATHS = [
  "/dashboard",
  "/cabinet",
  "/create",
  "/treasury",
  "/balance",
  "/history",
  "/invite",
];

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  const isAppHost = host.startsWith("app.");

  // On the app subdomain, "/" is the product entry, not the landing
  if (isAppHost && pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.rewrite(url);
  }

  // On the root domain, product routes bounce to the app subdomain
  // (only when it is actually configured)
  if (!isAppHost && appUrl && APP_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL(pathname + req.nextUrl.search, appUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico).*)"],
};
