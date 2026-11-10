"use client";

import { ScholarshipAssistance } from "@/components/scholarship/assistance";
import { useLocale } from "@/components/locale-context";
import type { AcslLanguage } from "./model";
import { AcslProgrammingSolutionView } from "./programming-solution";
import type { AcslProgrammingSolution } from "./teacher-model";

type AcslSolutionDelivery = {
  body: string;
  kind: "FULL_SOLUTION";
  language: string;
  contentId: string;
  solution: Omit<AcslProgrammingSolution<string>, "provenance">;
};

export function AcslStudentProgrammingSolution({
  path, paperVersionId, language, available,
}: {
  path: `schools/${string}/acsl/${string}/programming`;
  paperVersionId: string;
  language: AcslLanguage;
  available: boolean;
}) {
  const { locale } = useLocale();
  if (!available) {
    return <p className="text-sm text-muted-foreground" role="status">
      {locale === "en" ? "A reference implementation is not available for this problem." : "此题暂无参考实现。"}
    </p>;
  }
  return (
    <ScholarshipAssistance<AcslSolutionDelivery>
      key={`${path}:${paperVersionId}:${language}`}
      endpoint={`${path}/solution`}
      target={{ paperVersionId, contentLanguage: language }}
      kind="FULL_SOLUTION"
      description={locale === "en"
        ? "You can unlock the reference implementation and explanation before submitting. Your translation payment is credited toward the cost. Purchased solutions can be revisited free; passing a formal submission also gives free access."
        : "提交前即可使用奖学金解锁参考实现和解析，已付翻译费用可抵扣。购买后免费重看，正式提交通过后也可免费查看。"}
      renderBody={(_body, content) => <AcslProgrammingSolutionView solution={content.solution} language={language} />}
    />
  );
}
