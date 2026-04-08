import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand";
import { RegistrationForm } from "@/components/registration-form";
import { readSessionCookie } from "@/lib/auth";
import { getClientSessionBySlug } from "@/lib/client-data";

export default async function Home({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const sessionFromCookie = await readSessionCookie(cookieStore);
  const requestedSessionSlug = typeof params.session === "string" ? params.session : undefined;

  if (sessionFromCookie?.sessionSlug) {
    redirect(`/session/${sessionFromCookie.sessionSlug}`);
  }

  const session = requestedSessionSlug ? await getClientSessionBySlug(requestedSessionSlug) : null;

  return (
    <main className="min-h-screen">
      <header className="border-b border-white/10 bg-[#1a1a2e] text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <BrandWordmark />
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl justify-center px-4 py-8 sm:px-6 lg:py-14">
        <div className="w-full">
          <RegistrationForm sessionSlug={requestedSessionSlug} session={session} />
        </div>
      </section>
    </main>
  );
}
