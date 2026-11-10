"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-context";
import { area } from "@/components/teacher/shared";
import type { AcslLanguage } from "./model";
import { parseAcslDiagrams } from "./diagram-validation";
import { AcslNativeDiagram } from "./native-diagram";

export function AcslTeacherDiagramEditor({
  label,
  value,
  onChange,
  fieldName,
  language,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fieldName: string;
  language: AcslLanguage;
  disabled: boolean;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const id = useId();
  const parsed = parseAcslDiagrams(value);
  return (
    <details
      className="rounded-md border border-border p-3"
      data-od-id={`acsl-diagram-editor-${fieldName}`}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {label} · {tx("Advanced JSON", "高级 JSON")}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          {tx(
            "Use localized en/zh arrays of native drawing primitives. Existing diagrams stay unchanged unless edited here. Raw SVG and executable attributes are not accepted.",
            "使用 en/zh 数组保存原生图形数据。未在此修改时会保留已有图形；不接受原始 SVG 或可执行属性。",
          )}
        </p>
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          className={`${area} min-h-48 max-h-96 resize-none font-mono text-xs`}
          rows={12}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          spellCheck={false}
          aria-invalid={!parsed}
          aria-describedby={!parsed ? `${id}-error` : undefined}
        />
        {!parsed ? (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
            {tx(
              "Invalid diagram JSON. Check the en/zh arrays, dimensions and supported primitive fields before saving.",
              "图形 JSON 无效，请检查 en/zh 数组、尺寸和支持的图形字段后再保存。",
            )}
          </p>
        ) : (
          parsed[language].map((diagram) => (
            <AcslNativeDiagram
              key={diagram.id}
              diagram={diagram}
              language={language}
            />
          ))
        )}
      </div>
    </details>
  );
}
