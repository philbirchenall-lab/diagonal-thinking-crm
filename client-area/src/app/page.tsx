import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand";
import { RegistrationForm } from "@/components/registration-form";
import { readSessionCookie } from "@/lib/auth";
import { formatSessionDate, getClientEntryData } from "@/lib/client-data";

export default async function Home({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const sessionFromCookie = await readSessionCookie(cookieStore);
  const requestedSessionSlug = typeof params.session === "string" ? params.session : undefined;

  if (
    sessionFromCookie?.sessionSlug &&
    (!requestedSessionSlug || requestedSessionSlug === sessionFromCookie.sessionSlug)
  ) {
    redirect(`/session/${sessionFromCookie.sessionSlug}`);
  }

  const sessionMeta = requestedSessionSlug ? await getClientEntryData(requestedSessionSlug) : null;
  const heroMeta = [
    sessionMeta?.organisationName,
    sessionMeta?.date ? formatSessionDate(sessionMeta.date) : null,
    sessionMeta?.sessionType === "open_event" ? "Open event" : null,
  ].filter(Boolean);

  return (
    <main className="dt-shell">
      <section className="dt-auth-shell">
        <div className="dt-hero">
          <div className="dt-hero__logo">
            <BrandWordmark />
          </div>
          <p className="dt-hero__eyebrow">Client Area</p>
          <h1 className="dt-hero__title">{sessionMeta?.name ?? "Secure Session Access"}</h1>
          {heroMeta.length ? (
            <div className="dt-hero__meta">
              {heroMeta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
          <p className="dt-hero__sub">
            {sessionMeta
              ? "Use the email address tied to this session and we will send you a secure access link."
              : "Enter your details and we will send you a secure access link to your session materials."}
          </p>
        </div>
        <RegistrationForm sessionSlug={requestedSessionSlug} sessionMeta={sessionMeta} />
      </section>
    </main>
  );
}
