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
    const popup = window.open(resource.url, "_blank", "noopener,noreferrer");
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

    if (!popup) {
      window.location.href = resource.url;
    }
  }

  return (
    <div className="dt-resource-grid">
      {resources.map((resource) => (
        <article key={resource.id} className="dt-resource-card">
          <div>
            <p className="dt-resource-card__eyebrow">{resourceKindLabel(resource)}</p>
            <h2 className="dt-resource-card__title" style={{ marginTop: "10px" }}>
              {resource.label}
            </h2>
          </div>

          {resource.description ? (
            <p className="dt-resource-card__body">{resource.description}</p>
          ) : null}

          {isEmbed(resource) ? (
            <div className="dt-resource-card__embed">
              <iframe
                src={resource.url}
                title={resource.label}
                loading="lazy"
              />
            </div>
          ) : null}

          <div className="dt-resource-card__footer">
            <button
              type="button"
              onClick={() => void openResource(resource)}
              disabled={activeResourceId === resource.id}
              className="dt-btn-primary"
            >
              {activeResourceId === resource.id ? "Opening..." : "View resource"}
            </button>
            {activeResourceId === resource.id ? (
              <span className="dt-resource-card__status">Opening in a new tab...</span>
            ) : (
              <span className="dt-resource-card__status">
                {isFile(resource) ? "File download or document link" : "Opens in a new tab"}
              </span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
