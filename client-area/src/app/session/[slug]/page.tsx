import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand";
import { SessionResources } from "@/components/session-resources";
import { readSessionCookie } from "@/lib/auth";
import { formatSessionDate, getClientSessionBySlug } from "@/lib/client-data";

function buildSessionStartHref(slug: string) {
  const params = new URLSearchParams({ session: slug });
  return `/?${params.toString()}`;
}

export async function generateMetadata({ params }: PageProps<"/session/[slug]">) {
  const { slug } = await params;
  const session = await getClientSessionBySlug(slug);

  return {
    title: session ? `${session.name} - Diagonal Thinking` : "Session - Diagonal Thinking",
  };
}

export default async function SessionPage({ params }: PageProps<"/session/[slug]">) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const sessionFromCookie = await readSessionCookie(cookieStore);

  if (!sessionFromCookie?.sessionSlug) {
    redirect(buildSessionStartHref(slug));
  }

  if (sessionFromCookie.sessionSlug !== slug) {
    redirect(buildSessionStartHref(sessionFromCookie.sessionSlug));
  }

  const session = await getClientSessionBySlug(slug);

  if (!session) {
    redirect(buildSessionStartHref(slug));
  }

  return (
    <main className="min-h-screen bg-[#f5f6fb]">
      <header className="border-b border-white/10 bg-[#1a1a2e] text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center px-4 py-4 sm:px-6 lg:px-8">
          <BrandWordmark />
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="rounded-[1.5rem] border border-[#1a1a2e]/10 bg-white p-6 shadow-[0_18px_50px_rgba(26,26,46,0.06)]">
          <h1 className="text-3xl font-semibold tracking-tight text-[#1a1a2e] sm:text-4xl">
            {session.name}
          </h1>

          <div className="mt-4 text-sm text-slate-600">
            <div className="inline-flex rounded-xl border border-slate-200 px-4 py-3">
              <div className="text-slate-800">{formatSessionDate(session.date)}</div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <SessionResources sessionSlug={session.slug} resources={session.resources} />
        </div>
      </section>
    </main>
  );
}
