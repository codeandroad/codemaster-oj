"use client";

import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";

export function AcslSourceImages({
  sources,
  questionNumber,
  explanation = false,
}: {
  sources?: string[];
  questionNumber: number;
  explanation?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  return sources?.length ? (
    <div
      className="mt-4 space-y-4"
      data-od-id={
        explanation ? "acsl-explanation-images" : "acsl-statement-images"
      }
    >
      {sources.map((src, index) => (
        <AcslSourceImage
          key={src}
          src={src}
          label={
            explanation
              ? tx(
                  `Question ${questionNumber}, original explanation ${index + 1}`,
                  `第 ${questionNumber} 题，原始解析图 ${index + 1}`,
                )
              : tx(
                  `Question ${questionNumber}, original problem and answer choices ${index + 1}`,
                  `第 ${questionNumber} 题，原始题面与选项图 ${index + 1}`,
                )
          }
        />
      ))}
    </div>
  ) : null;
}

export function AcslSourceImage({
  src,
  label,
  className,
}: {
  src: string;
  label: string;
  className?: string;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  return (
    <figure className={className} data-od-id="acsl-source-image">
      <div
        className={`overflow-hidden rounded-md border border-border ${state === "ready" ? "" : "min-h-32"}`}
        aria-busy={state === "loading"}
      >
        {state === "loading" && (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            {tx("Loading original page…", "正在加载原始题页…")}
          </p>
        )}
        {state === "error" ? (
          <div role="alert" className="p-4 text-sm">
            <p>
              {tx(
                "The original page could not be loaded.",
                "原始题页加载失败。",
              )}
            </p>
            <Button
              className="mt-2"
              variant="secondary"
              size="sm"
              onClick={() => {
                setAttempt((value) => value + 1);
                setState("loading");
              }}
            >
              {tx("Retry loading", "重新加载")}
            </Button>
          </div>
        ) : (
          <div
            className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            data-od-id="acsl-source-scroll"
            role="region"
            aria-label={tx(
              "Original page image, scroll horizontally if needed",
              "原始题页图片，可横向滚动查看",
            )}
            tabIndex={state === "ready" ? 0 : undefined}
          >
            {/* Same-origin session cookies protect the original asset; an image optimizer must not fetch it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={attempt}
              src={src}
              alt={label}
              className={`h-auto w-full min-w-[48rem] max-w-none bg-white ${state === "loading" ? "hidden" : ""}`}
              onLoad={() => setState("ready")}
              onError={() => setState("error")}
            />
          </div>
        )}
      </div>
      {state === "ready" && (
        <p className="mt-1 text-xs text-muted-foreground lg:hidden">
          {tx(
            "Scroll sideways to read the original page.",
            "可横向滚动查看原始题页。",
          )}
        </p>
      )}
      <figcaption className="mt-1 text-xs">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {tx("Open original page in a new tab", "在新标签页查看原始题页")}
          <span className="sr-only"> · {label}</span>
        </a>
      </figcaption>
    </figure>
  );
}
