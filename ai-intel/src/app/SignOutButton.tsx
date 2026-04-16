"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={handleSignOut}
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "5px",
        color: "rgba(255,255,255,0.75)",
        cursor: "pointer",
        fontSize: "12px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        padding: "5px 12px",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.target as HTMLButtonElement).style.background =
          "rgba(255,255,255,0.14)";
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLButtonElement).style.background =
          "rgba(255,255,255,0.08)";
      }}
    >
      Sign out
    </button>
  );
}
