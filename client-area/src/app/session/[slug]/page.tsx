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

function buildLogoutHref(slug: string) {
  const params = new URLSearchParams({ session: slug });
  return `/logout?${params.toString()}`;
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

  const heroMeta = [
    session.organisationName,
    session.date ? formatSessionDate(session.date) : null,
    session.sessionType === "open_event" ? "Open event" : "In-house session",
  ].filter(Boolean);

  return (
    <main className="dt-shell">
      <a href={buildLogoutHref(slug)} className="dt-logout-link">
        Log out
      </a>

      <section className="dt-session-shell">
        <div className="dt-hero">
          <div className="dt-hero__logo">
            <BrandWordmark />
          </div>
          <p className="dt-hero__eyebrow">Client Area</p>
          <h1 className="dt-hero__title">{session.name}</h1>
          {heroMeta.length ? (
            <div className="dt-hero__meta">
              {heroMeta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
          <p className="dt-hero__sub">
            Your session materials are ready below. Each resource opens in a new tab so
            you can keep this page to hand.
          </p>
        </div>

        <SessionResources sessionSlug={session.slug} resources={session.resources} />

        <footer className="dt-footer">
          <a
            href="https://www.diagonalthinking.co"
            target="_blank"
            rel="noreferrer"
            className="dt-footer-link"
          >
            diagonalthinking.co
          </a>
        </footer>
      </section>
    </main>
  );
}
