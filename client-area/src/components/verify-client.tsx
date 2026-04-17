"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type VerifyClientProps = {
  token: string | null;
};

export function VerifyClient({ token }: VerifyClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "error" | "done">("loading");
  const [message, setMessage] = useState("Verifying your link...");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setStatus("error");
        setMessage("Missing verification token.");
        return;
      }

      try {
        const response = await fetch(`/api/client/auth/verify?token=${encodeURIComponent(token)}`, {
          method: "GET",
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error ?? "Verification failed.");
        }

        if (!cancelled) {
          setStatus("done");
          setMessage("Redirecting to your session...");
          router.replace(`/session/${data.sessionSlug}`);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Could not verify your link.");
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, token]);

  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-[#1a1a2e]">
        Verify access
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      {status === "error" ? (
        <button
          type="button"
          onClick={() => router.replace("/")}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-[#3B5CB5] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2d4a9a]"
        >
          Back to start
        </button>
      ) : (
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-[#3B5CB5]" />
        </div>
      )}
    </>
  );
}
