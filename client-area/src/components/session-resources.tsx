"use client";

import { useState } from "react";
import type { SessionResource } from "@/lib/client-data";

type SessionResourcesProps = {
  sessionSlug: string;
  resources: SessionResource[];
};

function isEmbed(resource: SessionResource) {
  return resource.type.toLowerCase() === "embed";
}


export function SessionResources({ sessionSlug, resources }: SessionResourcesProps) {
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);

  async function openResource(resource: SessionResource) {
    setActiveResourceId(resource.id);

    // Open the resource immediately (synchronous within user gesture — avoids popup blocker)
    if (!isEmbed(resource)) {
      window.open(resource.url, "_blank", "noopener,noreferrer");
    }

    try {
      await fetch("/api/client/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionSlug,
          resourceId: resource.id,
          resourceLabel: resource.label,
          resourceType: resource.type,
          resourceUrl: resource.url,
        }),
      });
    } catch {
      // Tracking should never block access.
    } finally {
      setActiveResourceId(null);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {resources.map((resource) => (
        <article
          key={resource.id}
          className="rounded-[1.15rem] border border-[#1a1a2e]/10 bg-white p-4 shadow-[0_18px_40px_rgba(26,26,46,0.05)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-[#1a1a2e]">{resource.label}</h3>
            </div>
            {activeResourceId === resource.id ? (
              <span className="text-xs text-slate-500">Opening</span>
            ) : null}
          </div>

          {isEmbed(resource) ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              <iframe
                src={resource.url}
                title={resource.label}
                className="h-72 w-full"
                loading="lazy"
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void openResource(resource)}
            className="mt-5 inline-flex items-center justify-center rounded-md bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#161616]"
          >
            {isEmbed(resource) ? "Track view" : "Open resource"}
          </button>
        </article>
      ))}
    </div>
  );
}

