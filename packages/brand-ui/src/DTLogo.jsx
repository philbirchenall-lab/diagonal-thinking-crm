"use client";

import { useEffect, useRef, useState } from "react";

const ASSET_PATHS = {
  full: {
    light: "/brand/logo-full.png",
    dark: "/brand/logo-full-white.png",
  },
  icon: {
    light: "/brand/logo-icon.png",
    dark: "/brand/logo-icon-white.png",
  },
};

const FULL_MIN_WIDTH = 200;
const ICON_MIN_WIDTH = 96;
const AUTO_SWAP_THRESHOLD = 200;
const DEFAULT_WIDTH_FULL = 200;
const DEFAULT_WIDTH_ICON = 64;

const FULL_ASPECT_RATIO = 2000 / 1000;
const ICON_ASPECT_RATIO = 690 / 684;

function isValidVariant(value) {
  return value === "full" || value === "icon" || value === "auto";
}

export default function DTLogo({
  variant = "auto",
  onDark = false,
  width,
  alt = "Diagonal Thinking",
  className = "",
}) {
  const safeVariant = isValidVariant(variant) ? variant : "auto";
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(
    width ?? DEFAULT_WIDTH_FULL,
  );
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (isValidVariant(variant) || typeof window === "undefined") {
      return;
    }

    console.warn(`[DTLogo] invalid variant "${variant}", falling back to "auto"`);
  }, [variant]);

  useEffect(() => {
    if (safeVariant !== "auto") {
      return;
    }

    const node = containerRef.current;
    if (!node) {
      return;
    }

    const measure = () => {
      const nextWidth = node.getBoundingClientRect().width;
      if (nextWidth > 0) {
        setContainerWidth(nextWidth);
      }
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [safeVariant]);

  const effectiveVariant =
    safeVariant === "auto"
      ? containerWidth >= AUTO_SWAP_THRESHOLD
        ? "full"
        : "icon"
      : safeVariant;

  const renderedWidth =
    width ?? (effectiveVariant === "full" ? DEFAULT_WIDTH_FULL : DEFAULT_WIDTH_ICON);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (effectiveVariant === "full" && renderedWidth < FULL_MIN_WIDTH) {
      console.warn(
        `[DTLogo] full lockup rendered at ${renderedWidth}px, below minimum ${FULL_MIN_WIDTH}px`,
      );
    }

    if (effectiveVariant === "icon" && renderedWidth < ICON_MIN_WIDTH) {
      console.warn(
        `[DTLogo] icon mark rendered at ${renderedWidth}px, below minimum ${ICON_MIN_WIDTH}px`,
      );
    }
  }, [effectiveVariant, renderedWidth]);

  const aspectRatio =
    effectiveVariant === "full" ? FULL_ASPECT_RATIO : ICON_ASPECT_RATIO;
  const renderedHeight = Math.round(renderedWidth / aspectRatio);
  const src = onDark
    ? ASSET_PATHS[effectiveVariant].dark
    : ASSET_PATHS[effectiveVariant].light;

  const rootStyle = {
    "--dt-logo-width": `${renderedWidth}px`,
    "--dt-logo-clearspace": "calc(var(--dt-logo-width) * 0.17)",
    display: "inline-block",
    width: `${renderedWidth}px`,
    height: `${renderedHeight}px`,
    lineHeight: 0,
  };

  if (imageFailed) {
    const fallbackText =
      effectiveVariant === "full" ? "DIAGONAL // THINKING" : "DT";
    const fontSize =
      effectiveVariant === "full"
        ? Math.round(renderedWidth * 0.13)
        : Math.round(renderedWidth * 0.55);

    return (
      <span
        ref={containerRef}
        role="img"
        aria-label={alt}
        className={className}
        style={{
          ...rootStyle,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: 'Oswald, "Arial Narrow", sans-serif',
          fontWeight: 400,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          fontSize: `${fontSize}px`,
          lineHeight: 1,
          color: onDark ? "#FFFFFF" : "#305DAB",
        }}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    <span ref={containerRef} className={className} style={rootStyle}>
      <img
        src={src}
        alt={alt}
        width={renderedWidth}
        height={renderedHeight}
        onError={() => setImageFailed(true)}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </span>
  );
}
