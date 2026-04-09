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
    <main className="min-h-screen bg-[#3B5CB5]">
      <header className="border-b border-white/10 bg-[#3B5CB5] text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <BrandWordmark />
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="rounded-[1.5rem] border border-white/10 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.15)]">
          <h1 className="text-3xl font-semibold tracking-tight text-[#1a1a2e] sm:text-4xl">
            {session.name}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-500">
            <span>{formatSessionDate(session.date)}</span>
          </div>

          <p className="mt-4 text-sm text-slate-600">Here are your session materials.</p>
        </div>

        <div className="mt-6">
          <SessionResources sessionSlug={session.slug} resources={session.resources} />
        </div>

        <footer className="mt-10 border-t border-white/20 pb-6 pt-6 text-center">
          <a
            href="https://www.diagonalthinking.co"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-white/70 hover:text-white transition"
          >
            diagonalthinking.co
          </a>
        </footer>
      </section>
    </main>
  );
}
