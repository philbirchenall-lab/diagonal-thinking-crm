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
    <div>
      <div className="dt-panel__header">
        <p className="dt-card-eyebrow">Client Area</p>
        <h2 className="dt-card-title">Verify access</h2>
        <p className="dt-card-copy">{message}</p>
      </div>
      {status === "error" ? (
        <button
          type="button"
          onClick={() => router.replace("/")}
          className="dt-btn-primary"
          style={{ marginTop: "24px" }}
        >
          Back to start
        </button>
      ) : (
        <div className="dt-progress">
          <div className="dt-progress__bar" />
        </div>
      )}
    </div>
  );
}
