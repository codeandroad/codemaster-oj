"use client";

import { useId, useState, type ReactNode } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AcslLanguage } from "./model";
import type {
  AcslDiagram,
  AcslDiagramElement,
  AcslDiagramPaint,
} from "./diagram-model";

const paints: Record<AcslDiagramPaint, string> = {
  ink: "var(--foreground)",
  muted: "var(--muted-foreground)",
  accent: "var(--primary)",
  surface: "var(--surface)",
  none: "none",
  red: "#dc2626",
  green: "#16a34a",
  blue: "#2563eb",
  yellow: "#eab308",
  orange: "#fb923c",
  cyan: "#06b6d4",
  magenta: "#d946ef",
  white: "#ffffff",
  black: "#000000",
};
const fonts = {
  sans: "var(--font-sans)",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "var(--font-mono)",
};
function paint(
  value: AcslDiagramPaint | undefined,
  fallback: AcslDiagramPaint,
) {
  return paints[value ?? fallback] ?? paints[fallback];
}

function elementShape(element: AcslDiagramElement, key: number): ReactNode {
  // Only these named properties reach native SVG elements. Never spread source data into props.
  const style = {
    stroke: paint(element.stroke, "ink"),
    fill: paint(element.fill, "none"),
    strokeWidth: element.strokeWidth ?? 1.5,
  };
  switch (element.type) {
    case "path":
      return <path key={key} d={element.d} {...style} />;
    case "line":
      return (
        <line
          key={key}
          x1={element.x1}
          y1={element.y1}
          x2={element.x2}
          y2={element.y2}
          {...style}
        />
      );
    case "polyline":
      return (
        <polyline
          key={key}
          points={element.points.map((point) => point.join(",")).join(" ")}
          {...style}
        />
      );
    case "circle":
      return (
        <circle
          key={key}
          cx={element.cx}
          cy={element.cy}
          r={element.r}
          {...style}
        />
      );
    case "rect":
      return (
        <rect
          key={key}
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          rx={element.rx}
          {...style}
        />
      );
    case "ellipse":
      return (
        <ellipse
          key={key}
          cx={element.cx}
          cy={element.cy}
          rx={element.rx}
          ry={element.ry}
          {...style}
        />
      );
    case "text":
      return (
        <text
          key={key}
          x={element.x}
          y={element.y}
          textAnchor={element.anchor ?? "start"}
          fontSize={element.fontSize ?? 16}
          fontFamily={fonts[element.font ?? "sans"]}
          fontWeight={element.weight ?? "normal"}
          stroke={paint(element.stroke, "none")}
          strokeWidth={element.strokeWidth ?? 1}
          fill={paint(element.fill, "ink")}
        >
          {element.text}
        </text>
      );
    default:
      return null;
  }
}

function DiagramSvg({
  diagram,
  language,
  enlarged = false,
}: {
  diagram: AcslDiagram;
  language: AcslLanguage;
  enlarged?: boolean;
}) {
  const titleId = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${diagram.width} ${diagram.height}`}
      width={diagram.width}
      height={diagram.height}
      role="img"
      aria-labelledby={titleId}
      className={
        enlarged ? "block h-auto w-full max-w-none" : "block h-auto max-w-full"
      }
      data-od-id="acsl-diagram-svg"
      data-diagram-id={diagram.id}
    >
      <title id={titleId}>{diagram.alt[language]}</title>
      {diagram.elements.map(elementShape)}
    </svg>
  );
}

export function AcslNativeDiagram({
  diagram,
  language,
  zoomable = true,
}: {
  diagram: AcslDiagram;
  language: AcslLanguage;
  zoomable?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [zoom, setZoom] = useState(1);
  return (
    <figure
      className="my-4 min-w-0 max-w-full"
      data-od-id="acsl-native-diagram"
    >
      <DiagramSvg diagram={diagram} language={language} />
      {zoomable && (
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1"
              data-od-id="acsl-diagram-expand"
              onClick={() => setZoom(1)}
            >
              <ZoomIn size={14} aria-hidden="true" />{" "}
              {tx("Enlarge diagram", "放大图形")}
              <span className="sr-only"> · {diagram.alt[language]}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col">
            <DialogTitle className="pr-8">
              {tx("Diagram", "题目图形")}
            </DialogTitle>
            <DialogDescription>{diagram.alt[language]}</DialogDescription>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={zoom <= 0.5}
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
                aria-label={tx("Zoom out", "缩小")}
              >
                <ZoomOut size={16} aria-hidden="true" />
              </Button>
              <span className="min-w-12 text-center text-sm" role="status">
                {new Intl.NumberFormat(locale, { style: "percent" }).format(
                  zoom,
                )}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={zoom >= 3}
                onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                aria-label={tx("Zoom in", "放大")}
              >
                <ZoomIn size={16} aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
                {tx("Reset zoom", "重置缩放")}
              </Button>
            </div>
            <div
              className="min-h-0 overflow-auto rounded-md border border-border bg-surface p-3 focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={0}
              role="region"
              aria-label={tx(
                "Enlarged diagram, scroll if needed",
                "放大图形，可按需滚动",
              )}
              data-od-id="acsl-diagram-zoom-region"
            >
              <div style={{ width: diagram.width * zoom }}>
                <DiagramSvg diagram={diagram} language={language} enlarged />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </figure>
  );
}
