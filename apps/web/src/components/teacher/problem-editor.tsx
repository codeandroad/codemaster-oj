"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavigationBlocker } from "@/components/navigation";
import {
  Copy,
  Eye,
  FileUp,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import {
  isPending,
  productionApi,
  type ProductionProblem,
  type CampusUser,
} from "@/lib/production-api";
import {teacherDraftKey} from "./teacher-drafts";
import {useTeacherDraft} from "./use-teacher-draft";
import {CodeEditor} from "../student/code-editor";
import {useWorkspaceTheme} from "../ui/theme-context";
import {defaultWorkspaceSettings} from "../student/workspace-settings";
import type {SubmissionLanguage} from "@/lib/production-api";
import styles from "./problem-editor.module.css";
import {TestDrawer,BatchTests,type EditorCase} from "./test-data-editor";
import { equalCaseWeights } from "./case-weights";
import {MathEditor} from "./math-editor";
import {MathContent} from "@/components/math-content";
import { Bank, Group, GroupTags, ManageGroups, reviewVisibilityLabel } from "./problem-banks";
import {
  area,
  Empty,
  Feedback,
  Field,
  input,
  link,
  Modal,
  panel,
  State,
  Table,
  Tabs,
  useAction,
  useData,
} from "./shared";

type MetadataLine =
  string | { name: string; type: string; description: string };
interface EditorProblem extends ProductionProblem {
  referenceLanguage?: "python" | "cpp" | "javascript";
  difficulty?: string;
  comparator?: "tokens" | "exact" | "json";
  inputDescription?: string;
  outputDescription?: string;
  parameters?: MetadataLine[];
  returnType?: string;
  editorial?: string;
  hints?: MetadataLine[];
  hintPolicy?: string;
  samples: EditorCase[];
  tests?: EditorCase[];
}
const tabs = [
  "题面",
  "接口与模板",
  "测试数据",
  "判题设置",
  "解答与提示",
  "版本与发布",
];
const blank: EditorProblem = {
  id: "new",
  title: "",
  mode: "stdio",
  statement: "",
  starterCode: "",
  starterCodes: { cpp: "", javascript: "" },
  referenceLanguage: "python",
  samples: [],
  tests: [],
  referenceCode: "",
  timeLimitMs: 1000,
  memoryLimitMb: 128,
  published: false,
  tags: [],
  source: "",
  functionName: "",
  inputDescription: "",
  outputDescription: "",
  difficulty: "基础",
  editorial: "",
  hints: [],
  hintPolicy: "afterAC",
};
const metadataText = (values: MetadataLine[] | undefined) =>
  (values ?? [])
    .map((value) =>
      typeof value === "string"
        ? value
        : `${value.name}: ${value.type}${value.description ? ` — ${value.description}` : ""}`,
    )
    .join("\n");
const editableSnapshot = (p: EditorProblem) =>
  JSON.stringify({
    title: p.title,
    mode: p.mode,
    comparator: p.comparator ?? "tokens",
    statement: p.statement,
    bankId: p.bankId,
    samples: p.samples,
    tests: p.tests ?? [],
    referenceCode: p.referenceCode ?? "",
    referenceLanguage: p.referenceLanguage ?? "python",
    starterCode: p.starterCode,
    starterCodes: {
      cpp: p.starterCodes?.cpp ?? "",
      javascript: p.starterCodes?.javascript ?? "",
    },
    timeLimitMs: p.timeLimitMs,
    memoryLimitMb: p.memoryLimitMb,
    functionName: p.functionName ?? "",
    tags: p.tags ?? [],
    source: p.source ?? "",
    difficulty: p.difficulty ?? "",
    inputDescription: p.inputDescription ?? "",
    outputDescription: p.outputDescription ?? "",
    parameters: p.parameters ?? [],
    returnType: p.returnType ?? "",
    editorial: p.editorial ?? "",
    hints: p.hints ?? [],
    hintPolicy: p.hintPolicy ?? "afterAC",
  });
export function TeacherProblemEditor({ id,user }: { id: string;user:CampusUser }) {
  const search = useSearchParams(),
    resource = useData<EditorProblem>(
      id === "new"
        ? null
        : `problems/${id}${search.get("versionId") ? `?versionId=${search.get("versionId")}` : ""}`,
    );
  return (
    <>
      <State resource={resource} />
      {(id === "new" || resource.data) && (
        <ProblemEditorForm key={`${id}:${search.get("versionId")??"latest"}`} initial={resource.data} user={user} />
      )}
    </>
  );
}
function ProblemEditorForm({ initial,user }: { initial: EditorProblem | null;user:CampusUser }) {
  const search = useSearchParams(),
    router = useRouter(),
    banks = useData<{ items: Bank[] }>("problem-banks"),
    groups = useData<{ items: Group[] }>("problem-groups"),
    [problem, setProblem] = useState<EditorProblem>(
      initial ?? { ...blank, bankId: search.get("bankId") ?? "" },
    ),
    [saved, setSaved] = useState<EditorProblem | null>(initial),
    [tab, setTab] = useState(
      search.get("tab") === "tests" ? "测试数据" : "题面",
    ),
    [templateLanguage,setTemplateLanguage]=useState<SubmissionLanguage>("python"),
    [preview, setPreview] = useState(false),
    [manage, setManage] = useState(false),
    [test, setTest] = useState<{
      kind: "samples" | "tests";
      index: number | null;
    } | null>(null),
    [batch, setBatch] = useState(false),
    [publish, setPublish] = useState(false),
    [impact, setImpact] = useState(false),
    action = useAction();
  const dirty =
      editableSnapshot(problem) !==
      editableSnapshot(
        saved ?? { ...blank, bankId: search.get("bankId") ?? "" },
      ),
    editable = !initial || initial.canEdit !== false,
    back =
      search.get("returnTo") ||
      (problem.bankId
        ? `/teacher/problems/banks/${problem.bankId}`
        : "/teacher/problems");
  const bankVisibility = banks.data?.items.find((bank) => bank.id === problem.bankId)?.visibility ?? saved?.bankVisibility;
  const draft=useTeacherDraft({storageKey:teacherDraftKey(user.id,initial?.id??"new",search.get("versionId")??"current",search.get("bankId")??""),baseline:editableSnapshot(initial??{...blank,bankId:search.get("bankId")??""}),snapshot:editableSnapshot(problem),baseVersion:initial?.versionId??"new",dirty,editable,onRestore:snapshot=>{const recovered=JSON.parse(snapshot);setProblem(current=>({...current,...recovered}));}});
  useNavigationBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!saved?.id || !isPending(saved.validationStatus ?? "")) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      productionApi<EditorProblem>(
        `problems/${saved.id}?versionId=${saved.versionId}`,
        { signal: controller.signal },
      )
        .then((result) => setSaved(result))
        .catch(() => {});
    }, 1800);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [saved]);
  const update = <K extends keyof EditorProblem>(
    key: K,
    value: EditorProblem[K],
  ) => setProblem((p) => ({ ...p, [key]: value }));
  const save = async (navigate=true) => {
    if (!editable) throw new Error("此题库仅授予阅读权限。");
    if(!Number.isInteger(problem.timeLimitMs)||problem.timeLimitMs<100||problem.timeLimitMs>5000)throw new Error("时间限制须为 100–5000 ms 的整数。");
    if(!Number.isInteger(problem.memoryLimitMb)||problem.memoryLimitMb<32||problem.memoryLimitMb>256)throw new Error("内存限制须为 32–256 MB 的整数。");
    if(problem.mode==="function"&&problem.functionName&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(problem.functionName))throw new Error("函数名只能包含字母、数字与下划线，且不能以数字开头。");
    const tests = problem.tests ?? [];
    const body = {
      ...problem,
      saveDraft: true,
      comparator: problem.mode === "function" ? "json" : problem.comparator === "exact" ? "exact" : "tokens",
      tests: equalCaseWeights(tests),
      functionName: problem.mode === "function" ? problem.functionName : "",
      // Python uses the legacy starterCode field. Sending a stale generated
      // starterCodes.python would otherwise override the teacher's edit.
      starterCodes: {
        cpp: problem.starterCodes?.cpp ?? "",
        javascript: problem.starterCodes?.javascript ?? "",
      },
    };
    const result = await productionApi<EditorProblem>(
      saved ? `problems/${saved.id}/versions` : "problems",
      { method: "POST", body },
    );
    draft.clear();
    setSaved(result);
    setProblem(result);
    if (!initial && navigate)
      router.replace(
        `/teacher/problems/${result.id}/edit?returnTo=${encodeURIComponent(back)}`,
      );
    return result;
  };
  const list = (kind: "samples" | "tests") => problem[kind] ?? [];
  return (
    <div className={styles.editor} data-od-id="teacher-problem-editor">
      <button
        className={`${link} mb-3 text-sm`}
        onClick={() => {
          if (!dirty || window.confirm("有未保存修改，确认离开编辑器？"))
            router.push(back);
        }}
      >
        ← 返回题库与题目
      </button>
      <PageHeader
        eyebrow="Problem editor"
        title={problem.title || "新建题目"}
        description={`${banks.data?.items.find((x) => x.id === problem.bankId)?.name ?? "尚未选择题库"} · 草稿保存与发布分别进行，已发布版本及历史成绩保留。`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPreview(true)}>
              <Eye size={15} />
              学生预览
            </Button>
            <Button
              disabled={action.busy || !editable}
              onClick={() =>
                void action.run(async () => {
                  await save();
                  return "草稿已保存，参考解验证结果在版本与发布页查看。";
                })
              }
            >
              <Save size={15} />
              保存草稿
            </Button>
            <Button
              variant="secondary"
              disabled={action.busy || !saved || dirty || !saved.canPublish}
              onClick={() => setPublish(true)}
            >
              <Send size={15} />
              发布
            </Button>
          </div>
        }
      />
      <Feedback action={action} />
      {draft.recovery&&<section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm" data-od-id="teacher-draft-recovery"><p>发现本机未保存草稿 · {new Date(draft.recovery.updatedAt).toLocaleString('zh-CN')} {draft.recovery.baseVersion!==(initial?.versionId??"new")&&"（服务器版本已变化，请核对后保存）"}</p><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={!editable} onClick={draft.restore}>恢复草稿</Button><Button size="sm" variant="ghost" onClick={draft.discard}>忽略草稿</Button></div></section>}
      {draft.status&&<p className="mt-2 text-xs text-muted-foreground" role="status" data-od-id="teacher-autosave-status">{draft.status}</p>}

      <div className={styles.toolbar}>
        <span className="text-muted-foreground">分组</span>
        <GroupTags
          onClick={saved?.id && editable ? () => setManage(true) : undefined}
          groups={
            groups.data?.items.filter((g) =>
              g.problemIds.includes(saved?.id ?? ""),
            ) ?? []
          }
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!editable || action.busy}
          onClick={() => {if(saved?.id && saved.bankId===problem.bankId)setManage(true);else void action.run(async()=>{await save(false);setManage(true);return "草稿已保存，可选择分组。";});}}
        >
          整理分组
        </Button>
        <StatusPill
          status={
            saved?.published
              ? "Published"
              : (saved?.validationStatus ?? "Draft")
          }
        />
        {saved && <span className="text-xs text-muted-foreground">{reviewVisibilityLabel(saved, bankVisibility)}</span>}
        {dirty && <span className="text-xs text-warning">有未保存修改</span>}
      </div>
      {!saved?.id&&<p className="text-xs text-muted-foreground">整理分组时先保存题目草稿；没有分组可在弹窗中直接新建。</p>}
      <State resource={groups}/>
      <Tabs value={tab} onChange={setTab} items={tabs} />
      <section className={`${panel} ${styles.body}`} data-od-id="teacher-editor-tab-content"><fieldset disabled={!editable || action.busy}>
        {tab === "题面" && (
          <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-5 max-lg:grid-cols-1">
            <div className="space-y-4">
              <Field label="题目标题">
                <input
                  autoFocus
                  value={problem.title}
                  disabled={!editable}
                  onChange={(e) => update("title", e.target.value)}
                  className={input}
                />
              </Field>
              <MathEditor fieldName="statement" label="题面 / Markdown 与 LaTeX" value={problem.statement} disabled={!editable} onChange={value=>update("statement",value)} rows={10} initialPreview/>

            </div>
            <aside className="space-y-4">
              <Field label="所属题库">
                <select
                  value={problem.bankId ?? ""}
                  disabled={!!saved || !editable}
                  onChange={(e) => update("bankId", e.target.value)}
                  className={input}
                >
                  <option value="">请选择题库</option>
                  {banks.data?.items
                    .filter(
                      (x) =>
                        x.canContribute ||
                        x.canEdit ||
                        ["owner", "edit"].includes(x.permission) ||
                        x.id === problem.bankId,
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="主题标签">
                <input
                  value={problem.tags?.join(", ") ?? ""}
                  disabled={!editable}
                  onChange={(e) =>
                    update(
                      "tags",
                      e.target.value
                        .split(/[,，]/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    )
                  }
                  className={input}
                />
              </Field>
              <Field label="难度">
                <select
                  value={problem.difficulty ?? "基础"}
                  onChange={(e) => update("difficulty", e.target.value)}
                  className={input}
                >
                  {["基础", "中等", "进阶"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="题目来源">
                <input
                  value={problem.source ?? ""}
                  onChange={(e) => update("source", e.target.value)}
                  className={input}
                />
              </Field>
              <section className="border border-border bg-surface-subtle p-4 text-xs leading-6 text-muted-foreground">
                题面支持普通文本与
                Markdown。图片链接应来自可访问的课程资料；正式测试与参考代码只向维护教师开放。
              </section>
            </aside>
          </div>
        )}
        {tab === "接口与模板" && (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                接口类型
              </p>
              <div className="mt-2 flex gap-2">
                {(["stdio", "function"] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant={problem.mode === mode ? "primary" : "secondary"}
                    disabled={!editable}
                    onClick={() => update("mode", mode)}
                  >
                    {mode === "stdio" ? "标准输入输出" : "函数题"}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                切换接口保留测试内容；请在测试数据页检查参数与期望返回值格式。
              </p>
            </div>
            {problem.mode === "function" ? (
              <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                <Field label="函数名">
                  <input
                    value={problem.functionName ?? ""}
                    onChange={(e) => update("functionName", e.target.value)}
                    className={input}
                  />
                </Field>
                <Field label="参数说明">
                  <input
                    value={metadataText(problem.parameters).replaceAll(
                      "\n",
                      "; ",
                    )}
                    onChange={(e) =>
                      update(
                        "parameters",
                        e.target.value
                          .split(";")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      )
                    }
                    className={input}
                  />
                </Field>
                <Field label="返回类型">
                  <input
                    value={problem.returnType ?? ""}
                    onChange={(e) => update("returnType", e.target.value)}
                    className={input}
                  />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                <MathEditor fieldName="input-description" label="输入说明" value={problem.inputDescription ?? ""} disabled={!editable} onChange={value=>update("inputDescription",value)} rows={4}/>
                <MathEditor fieldName="output-description" label="输出说明" value={problem.outputDescription ?? ""} disabled={!editable} onChange={value=>update("outputDescription",value)} rows={4}/>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
              <section className="min-w-0 space-y-3"><Field label="学生模板语言"><select aria-label="学生模板语言" value={templateLanguage} onChange={e=>setTemplateLanguage(e.target.value as SubmissionLanguage)} className={input}><option value="python">Python</option><option value="cpp">C++</option><option value="javascript">JavaScript</option></select></Field><CodeField language={templateLanguage} label="学生起始模板" value={templateLanguage==="python"?problem.starterCode:problem.starterCodes?.[templateLanguage]??""} onChange={value=>templateLanguage==="python"?update("starterCode",value):update("starterCodes",{...problem.starterCodes,[templateLanguage]:value})}/><p className="text-xs text-muted-foreground">各语言模板独立保存，留空时由系统生成。</p></section>
              <section className="min-w-0 space-y-3"><Field label="参考解答语言"><select aria-label="参考解答语言" value={problem.referenceLanguage??"python"} onChange={e=>update("referenceLanguage",e.target.value as SubmissionLanguage)} className={input}><option value="python">Python</option><option value="cpp">C++</option><option value="javascript">JavaScript</option></select></Field><CodeField language={problem.referenceLanguage??"python"} label="教师参考答案（不会显示给学生）" value={problem.referenceCode??""} onChange={value=>update("referenceCode",value)}/><p className="text-xs text-muted-foreground">切换语言只更改验证运行时，不会转换参考代码。</p></section>
            </div>
            {problem.mode==="function"&&<p className="text-xs text-muted-foreground">C++ 接口：<code className="font-mono">nlohmann::json {problem.functionName||"solve"}(json&amp; args, json&amp; kwargs)</code></p>}

          </div>
        )}
        {tab === "测试数据" && (
          <div className="space-y-6">
            {(["samples", "tests"] as const).map((kind) => (
              <section key={kind} className="border border-border">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-subtle px-4 py-3">
                  <div>
                    <h3 className="font-bold">
                      {kind === "samples" ? "公开样例" : "正式测试"} ·{" "}
                      {list(kind).length}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {kind === "samples"
                        ? "学生可见，不计入正式得分。"
                        : "一个输入与一个期望结果构成一个测试点；隐藏输入与期望答案不会显示给学生。"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {kind === "tests" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!editable}
                        onClick={() => setBatch(true)}
                      >
                        <FileUp size={14} />
                        批量导入
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!editable}
                      onClick={() => setTest({ kind, index: null })}
                    >
                      <Plus size={14} />
                      添加
                    </Button>
                  </div>
                </div>
                <Table
                  headers={[
                    "编号 / 名称",
                    problem.mode === "function" ? "参数" : "输入",
                    problem.mode === "function" ? "期望返回值" : "期望输出",
                    "启用",
                    "操作",
                  ]}
                  min={760}
                >
                  {list(kind).map((item, i) => (
                    <tr key={i}>
                      <td>
                        <span className="font-mono text-xs">
                          {kind === "samples" ? "S" : "T"}
                          {i + 1}
                        </span>
                        <p className="font-semibold">
                          {item.name ??
                            `${kind === "samples" ? "Sample" : "Test"} ${i + 1}`}
                        </p>
                      </td>
                      <td className="max-w-52">
                        <pre className="truncate font-mono text-xs">
                          {item.input || "合法空输入"}
                        </pre>
                      </td>
                      <td className="max-w-52">
                        <pre className="truncate font-mono text-xs">
                          {item.expected || "合法空输出"}
                        </pre>
                      </td>
                      <td>
                        <button
                          disabled={!editable}
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${item.enabled !== false ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}
                          onClick={() =>
                            update(
                              kind,
                              list(kind).map((x, j) =>
                                j === i
                                  ? { ...x, enabled: x.enabled === false }
                                  : x,
                              ),
                            )
                          }
                        >
                          {item.enabled !== false ? "启用" : "停用"}
                        </button>
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="编辑测试"
                            disabled={!editable}
                            onClick={() => setTest({ kind, index: i })}
                          >
                            <Pencil size={15} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="复制测试"
                            disabled={!editable}
                            onClick={() =>
                              update(kind, [
                                ...list(kind).slice(0, i + 1),
                                {
                                  ...item,
                                  name: `${item.name ?? "Test"} copy`,
                                },
                                ...list(kind).slice(i + 1),
                              ])
                            }
                          >
                            <Copy size={15} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="删除测试"
                            disabled={!editable}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "从当前草稿删除这条测试？已发布版本保留。",
                                )
                              )
                                update(
                                  kind,
                                  list(kind).filter((_, j) => i !== j),
                                );
                            }}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!list(kind).length && (
                    <Empty columns={5}>
                      尚无{kind === "samples" ? "公开样例" : "正式测试"}
                      。点击“添加”创建第一条。
                    </Empty>
                  )}
                </Table>
              </section>
            ))}
          </div>
        )}
        {tab === "判题设置" && (
          <div className="space-y-4">
            <div className={styles.summary}><div><strong>{problem.mode==="function"?"函数题":"标准输入输出"}</strong><span>题目接口</span></div><div><strong>{(problem.tests??[]).filter(x=>x.enabled!==false).length} / {(problem.tests??[]).length}</strong><span>启用 / 全部正式测试</span></div><div><strong>Python · C++ · JavaScript</strong><span>学生可用语言，参考解验证使用所选语言</span></div></div>
            <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
              <Field label="参考解验证语言"><select className={input} value={problem.referenceLanguage??"python"} onChange={e=>update("referenceLanguage",e.target.value as SubmissionLanguage)}><option value="python">Python</option><option value="cpp">C++</option><option value="javascript">JavaScript</option></select></Field>
              <Field label="时间限制（ms）"><input type="number" step={1} min={100} max={5000} value={problem.timeLimitMs} onChange={e=>update("timeLimitMs",Number(e.target.value))} className={input}/><p className="mt-1 text-xs text-muted-foreground">100–5000 ms，亦受运行环境上限约束。</p></Field>
              <Field label="内存限制（MB）"><input type="number" step={1} min={32} max={256} value={problem.memoryLimitMb} onChange={e=>update("memoryLimitMb",Number(e.target.value))} className={input}/><p className="mt-1 text-xs text-muted-foreground">32–256 MB；JavaScript 最低按 128 MB 执行。</p></Field>
              <Field label="输出比较方式"><select aria-label="输出比较方式" disabled={problem.mode==="function"} className={input} value={problem.mode==="function"?"json":problem.comparator==="exact"?"exact":"tokens"} onChange={e=>update("comparator",e.target.value as EditorProblem["comparator"])}>{problem.mode==="function"?<option value="json">JSON 返回值比较</option>:<><option value="tokens">按 token 比较（忽略空白差异）</option><option value="exact">精确文本比较</option></>}</select><p className="mt-1 text-xs text-muted-foreground">函数题由系统固定使用 JSON 比较。</p></Field>
              <Field label="测试计分"><div className="rounded-md border border-border px-3 py-2 text-sm">启用的正式测试点等权计分</div><p className="mt-1 text-xs text-muted-foreground">公开样例不计分，活动得分按作业或训练规则计算。</p></Field>
              <div className="flex flex-wrap items-start gap-2"><Button variant="secondary" onClick={()=>setTab("测试数据")}>管理测试数据</Button><Button variant="secondary" disabled={!editable||action.busy} onClick={()=>void action.run(async()=>{await save();setTab("版本与发布");return "草稿已保存，请查看参考解验证结果。";})}>验证参考解</Button></div>
            </div>
          </div>
        )}
        {tab === "解答与提示" && (
          <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-5 max-lg:grid-cols-1">
            <div className="space-y-4">
              <CodeField
                language={problem.referenceLanguage ?? "python"}
                label="参考代码"
                value={problem.referenceCode ?? ""}
                onChange={(v) => update("referenceCode", v)}
              />
              <MathEditor fieldName="editorial" label="题解" value={problem.editorial ?? ""} disabled={!editable} onChange={value=>update("editorial",value)} rows={5}/>
            </div>
            <aside className="space-y-4">
              <Field label="分级提示">
                <textarea
                  value={metadataText(problem.hints)}
                  onChange={(e) =>
                    update("hints", e.target.value.split("\n").filter(Boolean))
                  }
                  rows={8}
                  className={area}
                />
              </Field>
              <Field label="开放策略">
                <select
                  value={problem.hintPolicy ?? "afterAC"}
                  onChange={(e) => update("hintPolicy", e.target.value)}
                  className={input}
                >
                  <option value="afterAC">通过正式提交后开放</option>
                  <option value="always">始终可见</option>
                  <option value="never">不开放</option>
                </select>
              </Field>
              <Button
                disabled={action.busy || !editable}
                onClick={() =>
                  void action.run(async () => {
                    await save();
                    setTab("版本与发布");
                    return "参考解验证任务已提交。";
                  })
                }
              >
                <Send size={15} />
                检查参考解答
              </Button>
            </aside>
          </div>
        )}
        {tab === "版本与发布" && (
          <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 max-lg:grid-cols-1">
            <section className="space-y-4">
              <div className="border border-border p-4">
                <h3 className="font-bold">当前草稿版本</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  保存草稿与发布分别进行。已发布题目的修改不会覆盖历史作业仍在使用的旧版本。
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{bankVisibility === "school" ? "发布到校内题库后自动进入管理员审核；审核通过前，仅负责教师及指定作业或训练学生可见，不计入积分排行榜。" : "当前为教师私有题库。题目发布后可用于指定作业或训练；如需全校开放，请联系管理员纳入校内审核。"}</p>
                {saved && <p className="mt-2 text-sm font-medium">当前状态：{reviewVisibilityLabel(saved, bankVisibility)}</p>}
                <p className="mt-3 font-mono text-xs">
                  {saved?.versionId ?? "尚未保存"}
                </p>
              </div>
              <div className="border border-border">
                <div className="bg-surface-subtle px-4 py-3 font-bold">
                  发布检查
                </div>
                {[
                  ["题面", Boolean(problem.title && problem.statement)],
                  [
                    "接口",
                    problem.mode === "stdio" || Boolean(problem.functionName),
                  ],
                  [
                    "正式测试",
                    Boolean(problem.tests?.some((x) => x.enabled !== false)),
                  ],
                  ["参考解验证", saved?.canPublish === true],
                ].map(([label, ok]) => (
                  <div
                    key={String(label)}
                    className="flex justify-between border-t border-border px-4 py-3 text-sm"
                  >
                    <span>{label}</span>
                    <span className={ok ? "text-success" : "text-warning"}>
                      {ok ? "完整" : "待完善"}
                    </span>
                  </div>
                ))}
              </div>
              {saved?.validationMessage && (
                <p className="text-sm text-muted-foreground">
                  {saved.validationMessage}
                </p>
              )}
            </section>
            <aside className="space-y-3">
              <StatusPill status={saved?.validationStatus ?? "Draft"} />
              <Button variant="secondary" onClick={() => setImpact(true)}>
                查看版本影响
              </Button>
              <Button
                variant="secondary"
                disabled={!saved || action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const result = await productionApi<EditorProblem>(
                      `problems/${saved?.id}?versionId=${saved?.versionId}`,
                    );
                    setSaved(result);
                    return "验证结果已刷新。";
                  })
                }
              >
                刷新验证结果
              </Button>
              <Button
                variant="secondary"
                disabled={!editable || !saved?.canPublish || dirty || action.busy}
                onClick={() => setPublish(true)}
              >
                发布
              </Button>
            </aside>
          </div>
        )}
      </fieldset></section>
      {test && (
        <TestDrawer
          key={`${test.kind}-${test.index}`}
          mode={problem.mode}
          kind={test.kind}
          initial={
            test.index === null ? null : (list(test.kind)[test.index] ?? null)
          }
          onClose={() => setTest(null)}
          onSave={(value) => {
            update(
              test.kind,
              test.index === null
                ? [...list(test.kind), value]
                : list(test.kind).map((x, i) => (i === test.index ? value : x)),
            );
            setTest(null);
          }}
        />
      )}
      {batch && (
        <BatchTests
          mode={problem.mode}
          currentCount={problem.tests?.length ?? 0}
          onClose={() => setBatch(false)}
          onApply={(rows, replace) => {
            update(
              "tests",
              replace ? rows : [...(problem.tests ?? []), ...rows],
            );
            setBatch(false);
          }}
        />
      )}
      {manage && saved?.bankId && (
        <ManageGroups
          bankId={saved.bankId}
          problemIds={[saved.id]}
          onClose={() => {setManage(false);if(!initial)router.replace(`/teacher/problems/${saved.id}/edit?returnTo=${encodeURIComponent(back)}`);}}
          onSaved={() => {
            groups.reload();
            setManage(false);
            if(!initial)router.replace(`/teacher/problems/${saved.id}/edit?returnTo=${encodeURIComponent(back)}`);
          }}
        />
      )}
      {impact && (
        <Modal title="版本影响" onClose={() => setImpact(false)}>
          <p className="text-sm leading-7">
            发布后，新练习使用新的已发布版本。作业、计时训练、原提交和订正继续使用各自固定的版本。重判、发布成绩与版本发布分别进行。
          </p>
        </Modal>
      )}
      {publish && saved && (
        <Modal title="确认发布题目版本" onClose={() => setPublish(false)}>
          <p className="text-sm leading-6">
            发布“{saved.title}”的已验证版本。历史活动与提交保留原版本。{bankVisibility === "school" ? "本版本将进入管理员审核；通过前仅指定活动学生可见，也不会计入全校排名积分。" : "当前题库为教师私有，仅指定活动学生可见；如需全校开放，须由管理员调整题库范围并审核该版本。"}
          </p>
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPublish(false)}>
              取消
            </Button>
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const result = await productionApi<EditorProblem>(
                    `problems/${saved.id}/publish`,
                    { method: "POST", body: { versionId: saved.versionId } },
                  );
                  setSaved(result);
                  setProblem(result);
                  setPublish(false);
                  return "题目版本已发布；全校开放和积分资格须经管理员审核。";
                })
              }
            >
              确认发布
            </Button>
          </div>
        </Modal>
      )}
      {preview && (
        <ProblemPreview problem={problem} onClose={() => setPreview(false)} />
      )}
    </div>
  );
}
function CodeField({label,value,onChange,language="python"}:{label:string;value:string;onChange:(value:string)=>void;language?:SubmissionLanguage}){
 const pageTheme=useWorkspaceTheme();
 return <Field label={label}><div className={styles.code} data-od-id={`teacher-code-${label.includes("参考")?"reference":language}`}><CodeEditor idPrefix={`teacher-${label.includes("参考")?"reference":language}`} inputLabel={label} status="修改后需保存草稿" code={value} onChange={onChange} language={language} settings={{...defaultWorkspaceSettings,theme:pageTheme==="dark"?"vs_dark":"vs",fontSize:13}}/></div></Field>;
}
function ProblemPreview({
  problem,
  onClose,
}: {
  problem: EditorProblem;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="sticky top-0 flex justify-between border-b border-border bg-surface p-4">
        <div>
          <b>学生预览 · {problem.title || "未命名题目"}</b>
          <p className="text-xs text-muted-foreground">
            仅展示题面、公开样例与学生模板
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          ← 返回编辑
        </Button>
      </div>
      <div className="mx-auto grid max-w-[1400px] grid-cols-[44%_56%] max-md:grid-cols-1">
        <article className="min-h-[650px] border-r border-border bg-surface p-6">
          <h1 className="text-2xl font-bold">{problem.title}</h1>
          <div className="mt-5"><MathContent content={problem.statement}/></div>
          {problem.samples
            .filter((x) => x.enabled !== false)
            .map((sample, i) => (
              <section key={i} className="mt-6">
                <h2 className="font-bold">Sample {i + 1}</h2>
                <pre className="mt-3 whitespace-pre-wrap rounded bg-code p-3 text-xs text-code-foreground">
                  Input / Parameters{"\n"}
                  {sample.input}
                  {"\n\n"}Output / Return{"\n"}
                  {sample.expected}
                </pre>
              </section>
            ))}
        </article>
        <section className="bg-code p-5 text-code-foreground">
          <p className="text-xs text-code-muted">Python · starter.py</p>
          <pre className="mt-4 whitespace-pre-wrap font-mono text-sm leading-6">
            {problem.starterCode}
          </pre>
        </section>
      </div>
    </div>
  );
}
