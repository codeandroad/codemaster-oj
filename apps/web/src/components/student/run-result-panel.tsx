"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, X, Minus, Clock3, LoaderCircle, MapPin, LockKeyhole, ArrowLeftRight } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { isPending, type SubmissionLanguage } from "@/lib/production-api";
import type { DetailedSubmission } from "./shared";
import { codeLocationOffset, defaultResultCase, outputDifference, readableDiagnostic, type CodeLocation, type DiffPart } from "./result-feedback";
import styles from "./run-result-panel.module.css";

const titles: Record<string, [string, string]> = {
  AC: ["通过", "Accepted"], WA: ["答案错误", "Wrong Answer"], RE: ["运行错误", "Runtime Error"], CE: ["编译错误", "Compile Error"],
  TLE: ["运行超时", "Time Limit Exceeded"], MLE: ["超出内存限制", "Memory Limit Exceeded"], OLE: ["超出输出限制", "Output Limit Exceeded"],
  Executed: ["运行完成", "Finished"], Waiting: ["等待运行", "Queued"], Judging: ["正在运行", "Running"],
  "System Error": ["评测服务异常", "Judge Unavailable"], NotRun: ["尚未运行", "Not Run"], Submitted: ["已提交", "Submitted"],
};
const hints: Record<string, [string, string]> = {
  WA: ["程序已运行，但结果与预期不一致。请检查失败用例。", "Your program ran, but its result does not match the expected answer. Check the failed case."],
  RE: ["程序在运行过程中发生异常。请检查错误信息和对应代码。", "Your program stopped with an exception. Check the error and the corresponding code."],
  CE: ["代码未通过编译或函数接口检查，请检查语法、函数名称和参数。", "Compilation or function interface checks failed. Check syntax, the function name and parameters."],
  TLE: ["程序未在时间限制内完成，请检查循环终止条件和算法复杂度。", "The program did not finish in time. Check loop termination and algorithm complexity."],
  MLE: ["程序使用的内存超过限制，请检查数据规模和重复分配。", "Memory usage exceeded the limit. Check data size and repeated allocations."],
  OLE: ["输出超过限制，请检查意外的循环输出或调试日志。", "Output exceeded the limit. Check repeated printing and debug logs."],
  NotRun: ["前面的用例发生错误或总运行预算已耗尽，本用例尚未执行。", "This case was not executed after an earlier failure or the overall run budget was exhausted."],
  "System Error": ["评测服务暂不可用，这不是零分。请稍后刷新结果。", "The judge is temporarily unavailable. This is not a zero score. Refresh the result later."],
};

type Props = { result: DetailedSubmission | null; error: string; reload: () => void; loading?: boolean; currentCode?: string; currentLanguage?: SubmissionLanguage; onLocate?: (location: CodeLocation) => void };
export function RunResultPanel(props: Props) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  return <section className={styles.root} aria-label={tx("运行结果", "Run result")} aria-busy={props.loading}>
    {props.error && <div role="alert" className={styles.errorNotice}>{props.error}<Button variant="secondary" size="sm" onClick={props.reload}>{tx("重试加载", "Retry loading")}</Button></div>}
    {props.result ? <ResultContent key={props.result.id} {...props} result={props.result}/> : <p role="status" className={styles.empty}>{props.loading ? <><LoaderCircle size={16} className="animate-spin"/>{tx("正在接收运行任务…", "Starting your run…")}</> : props.error ? tx("暂时无法显示结果。", "The result could not be loaded.") : tx("运行代码后，在这里查看每个用例的结果。", "Run your code to see each test case result here.")}</p>}
  </section>;
}

function ResultContent({ result, reload, currentCode, currentLanguage, onLocate }: Props & { result: DetailedSubmission }) {
  const { locale } = useLocale(), id = useId();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const label = (status: string) => titles[status]?.[locale === "en" ? 1 : 0] ?? status;
  const [selected, setSelected] = useState<number | null>(null), [diff, setDiff] = useState(true);
  const caseList = useRef<HTMLDivElement>(null);
  const cases = result.testResults ?? [], index = selected == null ? defaultResultCase(cases, result.status) : Math.min(selected, cases.length - 1), active = cases[index];
  useEffect(() => {
    const list = caseList.current, tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !tab) return;
    if (tab.offsetLeft < list.scrollLeft || tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = Math.max(0, tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2);
  }, [index, cases.length]);
  const pending = isPending(result.status), hidden = !["samples", "custom"].includes(result.kind), publicCase = active?.visibility === "public";
  const status = active?.status ?? result.status;
  const caseDiagnostic = publicCase ? active.stderr : active?.status === "RE" ? active.runtimeError : undefined;
  const diagnosticText = result.resultsVisible === false ? "" : caseDiagnostic || (result.status === "CE" ? result.message ?? "" : "");
  const diagnostic = readableDiagnostic(diagnosticText, result.language, active?.mode === "function");
  const location = diagnostic.location && codeLocationOffset(result.code, diagnostic.location.line, diagnostic.location.column) !== null ? diagnostic.location : undefined;
  const stale = currentCode !== undefined && (currentCode !== result.code || currentLanguage !== undefined && currentLanguage !== (result.language ?? "python"));
  const canDiff = publicCase && active.status === "WA" && typeof active.output === "string" && typeof active.expected === "string";
  const difference = canDiff && diff ? outputDifference(active.output!, active.expected!) : null;
  const failed = !["AC", "Executed", "Waiting", "Judging", "Submitted"].includes(result.status);
  const hint = active?.reason === "input_mutation" ? tx("函数修改了输入参数。请返回计算结果，保留原输入数据。", "The function modified its input arguments. Return the result without changing the input.") : hints[status]?.[locale === "en" ? 1 : 0];
  return <>
    <div className={styles.heading}>
      <div className={styles.verdict} data-tone={pending ? "pending" : failed ? "error" : "success"} role="status">
        {pending && <LoaderCircle size={20} className="animate-spin"/>}<h3>{label(result.status)}</h3>
      </div>
      <div className={styles.metrics}>{active?.timeMs != null && <span><Clock3 size={13}/>{tx("用时", "Runtime")}: {active.timeMs} ms</span>}{active?.memoryKb != null && <span>{tx("内存", "Memory")}: {(active.memoryKb / 1024).toFixed(1)} MB</span>}</div>
      {canDiff && <button type="button" className={styles.diffButton} aria-pressed={diff} onClick={() => setDiff(value => !value)}><ArrowLeftRight size={14}/>{tx("差异", "Diff")}</button>}
    </div>
    <p className={styles.summary}>{result.kind === "samples" ? tx("公开样例自测", "Public sample run") : result.kind === "custom" ? tx("自定义运行 · 不判断正确性", "Custom run · correctness is not checked") : tx("正式评测", "Formal evaluation")}
      {result.passed != null && result.total != null && <> · {result.passed}/{result.total} {tx("通过", "passed")}</>}
      {hidden && result.score != null && <> · {Number(result.score).toFixed(2)}/100</>}
    </p>
    {stale && <p className={styles.notice}>{tx("当前代码已修改，以下结果对应上次运行的代码。", "Your code has changed. These results belong to the previous run.")}</p>}
    {pending && <p className={styles.notice}>{tx("任务已接收，结果会自动更新。", "Your run was received. Results update automatically.")} <button type="button" onClick={reload} className="text-primary hover:underline">{tx("刷新", "Refresh")}</button></p>}
    {!!cases.length && <div ref={caseList} className={styles.cases} role="tablist" aria-label={tx("测试结果用例", "Result test cases")} onKeyDown={event => {
      let next = index; if (event.key === "ArrowRight") next = (index + 1) % cases.length; else if (event.key === "ArrowLeft") next = (index - 1 + cases.length) % cases.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = cases.length - 1; else return;
      event.preventDefault(); setSelected(next); document.getElementById(`${id}-case-${next}`)?.focus();
    }}>{cases.map((item, i) => <button type="button" role="tab" key={item.position} id={`${id}-case-${i}`} aria-selected={i === index} aria-controls={`${id}-detail`} aria-label={`${tx("用例", "Case")} ${item.position}: ${label(item.status)}`} tabIndex={i === index ? 0 : -1} className={styles.case} onClick={() => setSelected(i)} data-tone={["AC", "Executed"].includes(item.status) ? "success" : item.status === "NotRun" ? "pending" : "error"}>
      {item.status === "NotRun" ? <Minus size={14}/> : ["AC", "Executed"].includes(item.status) ? <Check size={14}/> : <X size={14}/>} {tx("用例", "Case")} {item.position}
    </button>)}</div>}
    <div id={`${id}-detail`} role={active ? "tabpanel" : undefined} aria-labelledby={active ? `${id}-case-${index}` : undefined} className={styles.detail}>
      {active && <span className="sr-only">{label(active.status)}</span>}
      {hint && !pending && <p className={styles.hint} data-tone={status === "RE" ? "error" : undefined}>{hint}</p>}
      {diagnostic.text && <div className={styles.diagnostic}><div className={styles.diagnosticHeader}><strong>{tx("错误详情", "Error details")}</strong>{location && (onLocate ? <button type="button" disabled={stale} title={stale ? tx("代码已修改，请重新运行后定位", "Run the changed code again before locating the error") : undefined} onClick={() => onLocate(location)}><MapPin size={14}/>{location.file}:{location.line}{location.column ? `:${location.column}` : ""}</button> : <span>{location.file}:{location.line}</span>)}</div><pre>{diagnostic.text}</pre></div>}
      {publicCase && <>
        <Value label={tx("输入", "Input")} value={active.input ?? ""}/>
        {active.mode === "function" && active.stdout && <Value label={tx("标准输出 / 调试日志", "Stdout / debug log")} value={active.stdout}/>}
        {active.output != null && <Value label={active.mode === "function" ? tx("返回值", "Output / return value") : tx("实际输出", "Output")} value={active.output} parts={difference?.actual} tone="actual"/>}
        {active.expected !== undefined && <Value label={tx("预期结果", "Expected")} value={active.expected} parts={difference?.expected} tone="expected"/>}
      </>}
      {active?.truncated && (publicCase || diagnostic.text) && <p className={styles.notice}>{tx("输出或日志较长，仅显示保存的前段内容。", "The output or log is long. Only the retained beginning is shown.")}</p>}
      {canDiff && diff && <p className={styles.summary}>{tx("高亮表示不同内容；差异中的空格、制表符和换行分别显示为 ·、⇥、↵。", "Highlights show differences; changed spaces, tabs and newlines appear as ·, ⇥ and ↵.")}</p>}
      {(hidden || result.resultsVisible === false) && !pending && <p className={styles.privacy}><LockKeyhole size={14}/>{result.resultsVisible === false ? tx("详细成绩尚未公布，不代表零分。", "Detailed results have not been released. This is not a zero score.") : <span>{tx("正式测试的输入和预期结果不公开。", "Formal test inputs and expected results are private.")}{status === "RE" && !diagnostic.text && tx(" 可运行公开样例或自定义输入来查看异常详情。", " Run public samples or custom input to inspect error details.")}</span>}</p>}
      {!cases.length && result.publicOutput && !hidden && result.resultsVisible !== false && <Value label={tx("运行输出", "Run output")} value={result.publicOutput}/>}
    </div>
  </>;
}

function Value({ label, value, parts, tone }: { label: string; value: string; parts?: DiffPart[]; tone?: "actual" | "expected" }) {
  const { locale } = useLocale();
  return <div className={styles.value}><h4>{label}</h4><pre>{value === "" ? <span className={styles.blank}>{locale === "en" ? "(empty)" : "（空）"}</span> : parts ? parts.map((part, i) => part.changed ? <mark key={i} data-tone={tone}>{part.text.replaceAll(" ", "·").replaceAll("\t", "⇥").replaceAll("\n", "↵\n").replaceAll("\r", "␍")}</mark> : <span key={i}>{part.text}</span>) : value}</pre></div>;
}
