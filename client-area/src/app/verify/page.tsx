import { BrandWordmark } from "@/components/brand";
import { VerifyClient } from "@/components/verify-client";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;

  return (
    <main className="dt-shell">
      <section className="dt-auth-shell">
        <div className="dt-hero">
          <div className="dt-hero__logo">
            <BrandWordmark />
          </div>
          <p className="dt-hero__eyebrow">Client Area</p>
          <h1 className="dt-hero__title">Verify Access</h1>
          <p className="dt-hero__sub">
            We are checking your secure link and routing you to the right session.
          </p>
        </div>
        <div className="dt-panel dt-panel--compact">
        <VerifyClient token={token} />
        </div>
      </section>
    </main>
  );
}
