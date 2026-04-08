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
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-[1.5rem] border border-[#1a1a2e]/10 bg-white p-6 shadow-[0_18px_50px_rgba(26,26,46,0.08)]">
        <BrandWordmark />
        <VerifyClient token={token} />
      </div>
    </main>
  );
}

