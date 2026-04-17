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

function isFile(resource: SessionResource) {
  return resource.type.toLowerCase() === "file";
}

function resourceKindLabel(resource: SessionResource) {
  const type = resource.type.toLowerCase();
  if (type === "file") return "File";
  if (type === "embed") return "Embed";
  return "Link";
}

export function SessionResources({ sessionSlug, resources }: SessionResourcesProps) {
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);

  async function openResource(resource: SessionResource) {
    setActiveResourceId(resource.id);

    try {
      await fetch("/api/client/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    if (!isEmbed(resource)) {
      window.open(resource.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {resources.map((resource) => (
        <article
          key={resource.id}
          className="rounded-[1.15rem] border border-[#3B5CB5]/10 bg-white p-4 shadow-[0_18px_40px_rgba(59,92,181,0.05)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[#3B5CB5]">
                {resourceKindLabel(resource)}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-[#1a1a2e]">{resource.label}</h3>
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
          ) : resource.description ? (
            <p className="mt-4 text-sm leading-6 text-slate-600">{resource.description}</p>
          ) : null}

          <button
            type="button"
            onClick={() => void openResource(resource)}
            className="mt-5 inline-flex items-center justify-center rounded-md bg-[#3B5CB5] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2d4a9a]"
          >
            {isEmbed(resource) ? "Track view" : isFile(resource) ? "Download" : "Open resource"}
          </button>
        </article>
      ))}
    </div>
  );
}
