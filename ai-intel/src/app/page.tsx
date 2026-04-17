import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./SignOutButton";

export default async function WikiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* DT nav bar */}
      <nav
        style={{
          height: "44px",
          flexShrink: 0,
          background: "#1d2d44",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              background: "#E8552A",
              borderRadius: "5px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: 700,
              fontSize: "10px",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              letterSpacing: "-0.02em",
              flexShrink: 0,
            }}
          >
            D//T
          </div>
          <span
            style={{
              color: "white",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            AI Intelligence
          </span>
          <span
            style={{
              color: "rgba(255,255,255,0.35)",
              fontSize: "11px",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            Internal
          </span>
        </div>

        <SignOutButton />
      </nav>

      {/* Wiki iframe — fills remaining viewport */}
      <iframe
        src="/wiki.html"
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          display: "block",
        }}
        title="AI Intelligence Wiki"
      />
    </div>
  );
}
