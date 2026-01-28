import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME } from "@/app/admin/constants";
import { getServerAuthUser } from "@/server/auth";
import { debugOnce } from "@/server/db/schemaErrors";
import { shouldLogAdminDebug } from "@/server/admin/adminDebug";

const ALLOWED_ADMIN_USER_IDS = new Set([
  "5c7018e4-7860-40ec-abe6-8b83d3177733", // jackson
]);

const ALLOWED_ADMIN_EMAILS = new Set([
  "jackson.zartman@gmail.com",
]);

function isAllowlisted(user: { id: string; email?: string | null }): boolean {
  if (ALLOWED_ADMIN_USER_IDS.has(user.id)) return true;
  const email = (user.email ?? "").trim().toLowerCase();
  return Boolean(email) && ALLOWED_ADMIN_EMAILS.has(email);
}

function resolveVercelEnv(): string {
  return process.env.VERCEL_ENV ?? "unknown";
}

function resolveSafeNextAdminPath(requestUrl: URL): string | null {
  const next = requestUrl.searchParams.get("next");
  if (typeof next !== "string") return null;
  const trimmed = next.trim();
  // Safe-deny open redirects.
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  // Only allow navigating within /admin/* after unlocking.
  if (!trimmed.startsWith("/admin")) return null;
  return trimmed;
}

function loginRedirect(request: NextRequest) {
  const url = new URL("/login", request.url);
  // Preserve the original requested unlock URL (including ?next=) so /login can
  // send the user back to the correct destination post-auth.
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.searchParams.set("next", nextPath);
  return NextResponse.redirect(url);
}

function htmlResponse(html: string, status = 200) {
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const vercelEnv = resolveVercelEnv();
  if (vercelEnv === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const nextPath = resolveSafeNextAdminPath(requestUrl);

  const { user } = await getServerAuthUser({ quiet: true });
  if (!user) {
    console.info("[admin] /admin/unlock: anonymous -> redirect to /login", {
      userId: null,
      hasAdminCookie: false,
      vercelEnv,
      next: nextPath,
      redirectTarget: "/login?next=/admin/unlock",
    });
    return loginRedirect(request);
  }

  const cookieStore = await cookies();
  const hasAdminCookie = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "1";
  if (hasAdminCookie) {
    const redirectTarget = nextPath ?? "/admin/quotes";
    console.info("[admin] /admin/unlock: already unlocked -> redirect", {
      userId: user.id,
      hasAdminCookie: true,
      vercelEnv,
      next: nextPath,
      redirectTarget,
    });
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  }

  const allowlisted = isAllowlisted({ id: user.id, email: user.email });
  console.info("[admin] /admin/unlock: render page", {
    userId: user.id,
    hasAdminCookie: false,
    vercelEnv,
    redirectTarget: null,
    allowlisted,
    next: nextPath,
  });

  const formAction = nextPath
    ? `/admin/unlock?next=${encodeURIComponent(nextPath)}`
    : "/admin/unlock";

  const body = allowlisted
    ? `
      <form method="post" action="${formAction}" style="margin-top: 16px">
        <button type="submit" style="padding: 10px 14px; border-radius: 10px; background: #10b981; color: #052e16; font-weight: 700; border: none; cursor: pointer;">
          Unlock admin for this environment
        </button>
      </form>
    `
    : `
      <p style="margin-top: 16px; color: #cbd5e1;">
        This account is not allowlisted to unlock admin on preview deployments.
      </p>
    `;

  return htmlResponse(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Admin unlock</title>
      </head>
      <body style="margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background: #020617; color: #f8fafc;">
        <main style="max-width: 720px; margin: 0 auto; padding: 48px 20px;">
          <h1 style="margin: 0; font-size: 22px;">Admin unlock (preview only)</h1>
          <p style="margin-top: 12px; color: #94a3b8; line-height: 1.5;">
            This page exists so you can set the admin gate cookie for the current preview domain.
            It is disabled in production.
          </p>
          ${body}
          <p style="margin-top: 24px; color: #64748b; font-size: 12px;">
            VERCEL_ENV: <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${vercelEnv}</span>
          </p>
        </main>
      </body>
    </html>
  `);
}

export async function POST(request: NextRequest) {
  const vercelEnv = resolveVercelEnv();
  if (vercelEnv === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const { user } = await getServerAuthUser({ quiet: true });
  if (!user) {
    console.info("[admin] /admin/unlock POST: anonymous -> redirect to /login", {
      userId: null,
      hasAdminCookie: false,
      vercelEnv,
      redirectTarget: "/login?next=/admin/unlock",
    });
    return loginRedirect(request);
  }

  const allowlisted = isAllowlisted({ id: user.id, email: user.email });
  if (!allowlisted) {
    console.info("[admin] /admin/unlock POST: not allowlisted", {
      userId: user.id,
      hasAdminCookie: false,
      vercelEnv,
      redirectTarget: null,
      allowlisted,
    });
    return htmlResponse("Not authorized.", 403);
  }

  const nextPath = resolveSafeNextAdminPath(new URL(request.url));
  const redirectTarget = nextPath ?? "/admin/quotes";
  const res = NextResponse.redirect(new URL(redirectTarget, request.url));

  const secure = request.nextUrl.protocol === "https:";
  const maxAge = 60 * 60 * 8; // 8 hours
  res.cookies.set(ADMIN_COOKIE_NAME, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });

  if (shouldLogAdminDebug()) {
    debugOnce(
      `admin_unlock:set_cookie:${ADMIN_COOKIE_NAME}:${secure}:${maxAge}`,
      "[admin unlock] set admin cookie with",
      {
        name: ADMIN_COOKIE_NAME,
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge,
      },
    );
  }

  console.info("[admin] /admin/unlock POST: unlocked", {
    userId: user.id,
    hasAdminCookie: true,
    vercelEnv,
    redirectTarget,
  });

  return res;
}

