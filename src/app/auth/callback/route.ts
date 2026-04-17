import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isEmailAllowed } from "@/lib/env";

type CookieTuple = { name: string; value: string; options?: CookieOptions };

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  const response = NextResponse.redirect(new URL(next, url.origin));

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", url.origin));
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (all: CookieTuple[]) => {
          for (const { name, value, options } of all) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?error=exchange", url.origin));
  }

  if (!isEmailAllowed(data.user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=not_allowed", url.origin));
  }

  return response;
}
