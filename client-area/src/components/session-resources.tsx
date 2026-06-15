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

function fileExtensionLabel(name?: string | null) {
  const clean = String(name ?? "");
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toUpperCase() : "";
}

function formatBytes(bytes?: number | null) {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

function fileMetaLabel(resource: SessionResource) {
  const parts = [fileExtensionLabel(resource.fileName), formatBytes(resource.sizeBytes)].filter(
    Boolean,
  );
  return parts.length ? parts.join(" · ") : "Secure download";
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

          {isFile(resource) ? (
            <div className="dt-resource-card__footer">
              {/* The href is the auth-checked download endpoint, which logs the
                  download and redirects to a 5-minute signed URL. A same-tab
                  link gives the cleanest download on desktop and iOS Safari. */}
              <a href={resource.url} className="dt-btn-primary" rel="noopener">
                Download
              </a>
              <span className="dt-resource-card__status">{fileMetaLabel(resource)}</span>
            </div>
          ) : (
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
                <span className="dt-resource-card__status">Opens in a new tab</span>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
