"use client";

import { useLocale } from "@/components/locale-context";
import { input } from "@/components/student/shared";

export type Paper4RewardRule = {
  amount: number;
  minimumAc: number;
  minimumScore: number;
  taskKind: "challenge" | "learning" | "correction";
  allowSolutionAssisted: boolean;
};
export const defaultPaper4RewardRule: Paper4RewardRule = {
  amount: 0,
  minimumAc: 1,
  minimumScore: 0,
  taskKind: "challenge",
  allowSolutionAssisted: false,
};
export function Paper4RewardFields({
  value,
  onChange,
  cap,
  maximumQuestions,
  disabled,
}: {
  value: Paper4RewardRule;
  onChange: (value: Paper4RewardRule) => void;
  cap: number;
  maximumQuestions: number;
  disabled: boolean;
}) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "zh" ? zh : en);
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <label className="flex flex-wrap items-center gap-3 text-sm font-medium">
        {tx("每人每活动额外奖学金", "Extra scholarship per student / activity")}
        <input
          type="number"
          className={`${input} !w-24`}
          min={0}
          max={cap}
          value={value.amount}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, amount: Number(e.target.value) })
          }
        />
        <span className="text-xs font-normal text-muted-foreground">
          {tx(
            `上限 ${cap}，0 为无额外奖励`,
            `Maximum ${cap}; 0 means no extra reward`,
          )}
        </span>
      </label>
      {value.amount > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              {tx("至少通过大题数", "Minimum accepted questions")}
              <input
                className={`${input} mt-1`}
                type="number"
                min={1}
                max={maximumQuestions}
                value={value.minimumAc}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...value, minimumAc: Number(e.target.value) })
                }
              />
            </label>
            <label className="text-sm">
              {tx("最低得分百分比", "Minimum score percent")}
              <input
                className={`${input} mt-1`}
                type="number"
                min={0}
                max={100}
                value={value.minimumScore}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...value, minimumScore: Number(e.target.value) })
                }
              />
            </label>
            <label className="text-sm">
              {tx("任务目标", "Task purpose")}
              <select
                className={`${input} mt-1`}
                value={value.taskKind}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    taskKind: e.target.value as Paper4RewardRule["taskKind"],
                    allowSolutionAssisted:
                      e.target.value === "challenge"
                        ? false
                        : value.allowSolutionAssisted,
                  })
                }
              >
                <option value="challenge">{tx("挑战", "Challenge")}</option>
                <option value="learning">{tx("学习", "Learning")}</option>
                <option value="correction">{tx("订正", "Correction")}</option>
              </select>
            </label>
          </div>
          {value.taskKind !== "challenge" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.allowSolutionAssisted}
                onChange={(e) =>
                  onChange({
                    ...value,
                    allowSolutionAssisted: e.target.checked,
                  })
                }
              />
              {tx(
                "允许在查看完整题解后获得活动奖励",
                "Allow activity rewards after viewing a full solution",
              )}
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            {tx(
              "规则随活动公示，活动开始后冻结；模拟考试在成绩首次公布后结算。",
              "Rules are shown with the activity and frozen when it starts. Mock exam rewards settle when results are first released.",
            )}
          </p>
        </>
      )}
    </div>
  );
}
