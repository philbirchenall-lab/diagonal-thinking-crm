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
    <main className="flex min-h-screen items-center justify-center bg-[#3B5CB5] px-4 py-10">
      <div className="w-full max-w-md rounded-[1.5rem] border border-white/10 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.15)]">
        <BrandWordmark />
        <VerifyClient token={token} />
      </div>
    </main>
  );
}
