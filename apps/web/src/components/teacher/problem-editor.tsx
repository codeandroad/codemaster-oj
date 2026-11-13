"use client";

import { ProblemTutorialEditor } from "./problem-tutorial-editor";
import { ProblemAssistanceEditor } from "./problem-assistance-editor";
import { ProblemEditorSteps, SaveAndEditNext } from "./problem-editor-steps";
import type { ProblemEditorNavigation, ProblemEditorTarget } from "./problem-editor-navigation";

import { useEffect, useId, useState, useTransition } from "react";
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
import { ProblemPublicationStatus } from "@/components/problem-publication-status";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import {
  apiMessage,
  isPending,
  productionApi,
  type ProductionProblem,
  type CampusUser,
} from "@/lib/production-api";
import {teacherDraftKey} from "./teacher-drafts";
import {useTeacherDraft} from "./use-teacher-draft";
import {CodeEditor} from "../student/code-editor";
import {CopyCodeButton} from "../student/copy-code-button";
import {useWorkspaceTheme} from "../ui/theme-context";
import {defaultWorkspaceSettings} from "../student/workspace-settings";
import type {SubmissionLanguage} from "@/lib/production-api";
import styles from "./problem-editor.module.css";
import {TestDrawer,BatchTests,type EditorCase} from "./test-data-editor";
import { equalCaseWeights } from "./case-weights";
import {MathEditor} from "./math-editor";
import {MathContent} from "@/components/math-content";
import { Bank, Group, GroupTags, ManageGroups, reviewVisibilityLabel, validationStatusLabel } from "./problem-banks";
import { useLocale } from "@/components/locale-context";
import {
  area,
  Empty,
  Feedback,
  Field,
  input,
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
  ownerScope?: "platform" | "school";
  bankName?: string;
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
  "教程",
  "版本与发布",
];
const englishTabs: Record<string,string> = { "题面":"Statement", "接口与模板":"Interface and templates", "测试数据":"Test data", "判题设置":"Judge settings", "解答与提示":"Solutions and hints", "教程":"Tutorial", "版本与发布":"Versions and publication" };
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
type TeacherProblemEditorProps = {
  id: string;
  user: CampusUser;
  scope?: "school" | "platform";
  onClose?: () => void;
  navigation?: ProblemEditorNavigation;
};

export function TeacherProblemEditor(props: TeacherProblemEditorProps) {
  const search = useSearchParams();
  const platform = props.scope === "platform" || search.get("source") === "platform";
  const versionId = search.get("versionId");
  return <ProblemEditorResource key={`${platform}:${props.id}:${versionId ?? "latest"}`}
    {...props} platform={platform} versionId={versionId} />;
}

function ProblemEditorResource({ id, user, platform, versionId, onClose, navigation }: TeacherProblemEditorProps & { platform: boolean; versionId: string | null }) {
  const { locale } = useLocale();
  const search = useSearchParams();
  const endpoint = platform ? "platform/source-problems" : "problems";
  const resource = useData<EditorProblem>(id === "new" ? null
    : `${endpoint}/${encodeURIComponent(id)}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`);
  return (
    <>
      {id !== "new" && !resource.data && onClose && <Button type="button" variant="ghost" onClick={onClose}>
        {locale === "zh" ? "返回题目列表" : "Back to problems"}
      </Button>}
      <State resource={resource} />
      {(id === "new" || resource.data) && (
        <ProblemEditorForm key={`${search.get("solutionVersionId")??"student"}:${search.get("tab")??"statement"}:${search.get("kind")??"FULL_SOLUTION"}`} initial={resource.data} user={user} platform={platform || resource.data?.ownerScope === "platform"} onClose={onClose} navigation={navigation} />
      )}
    </>
  );
}
function ProblemEditorForm({ initial, user, platform, onClose, navigation }: {
  initial: EditorProblem | null; user: CampusUser; platform: boolean;
  onClose?: () => void; navigation?: ProblemEditorNavigation;
}) {
  const endpoint = platform ? "platform/source-problems" : "problems";
  const canPublish = !platform || user.platformAdmin === true;
  const { locale } = useLocale();
  const tr = (zh:string,en:string) => locale === "zh" ? zh : en;
  const tagsHintId = useId();
  const [tagsText, setTagsText] = useState<string | null>(null);
  const search = useSearchParams(),
    router = useRouter(),
    banks = useData<{ items: Bank[] }>(platform ? user.platformAdmin ? "platform/problem-banks" : null : "problem-banks"),
    groups = useData<{ items: Group[] }>(platform ? null : "problem-groups"),
    [problem, setProblem] = useState<EditorProblem>(
      initial ?? { ...blank, bankId: search.get("bankId") ?? "" },
    ),
    [saved, setSaved] = useState<EditorProblem | null>(initial),
    [requestedTab, setTab] = useState(() => {
      if (search.get("tab") === "tests") return "测试数据";
      if (search.get("tab") === "tutorial") return "教程";
      if (search.get("tab") === "solutions") return "解答与提示";
      return "题面";
    }),
    [solutionsVisited, setSolutionsVisited] = useState(() => search.get("tab") === "solutions"),
    [solutionPending, setSolutionPending] = useState(false),
    [tutorialVisited, setTutorialVisited] = useState(() => search.get("tab") === "tutorial"),
    [tutorialState, setTutorialState] = useState({ dirty: false, busy: false }),
    [switching, startSwitch] = useTransition(),
    [switchError, setSwitchError] = useState(""),
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
  const showTutorial = !saved || saved.canManageTutorial === true;
  const visibleTabs = showTutorial ? tabs : tabs.filter(item => item !== "教程");
  const tab = visibleTabs.includes(requestedTab) ? requestedTab : "题面";
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
  const draft=useTeacherDraft({storageKey:teacherDraftKey(user.id,saved?.id??"new",search.get("versionId")??"current",platform ? "platform" : search.get("bankId")??""),baseline:editableSnapshot(initial??{...blank,bankId:search.get("bankId")??""}),snapshot:editableSnapshot(problem),baseVersion:initial?.versionId??"new",dirty,editable,onRestore:snapshot=>{const recovered=JSON.parse(snapshot);setTagsText(null);setProblem(current=>({...current,...recovered}));}});
  const steps = initial && editable ? navigation : undefined;
  const nextStep = steps?.next;
  const stepDisabled = action.busy || switching || solutionPending || tutorialState.busy;
  function switchProblem(target: ProblemEditorTarget, afterSave = false) {
    setSwitchError("");
    startSwitch(async () => {
      try {
        await target.select();
        if (dirty && !afterSave && !draft.recovery) draft.discard();
      } catch (error) {
        setSwitchError(apiMessage(error));
      }
    });
  }
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
        `${endpoint}/${saved.id}?versionId=${saved.versionId}`,
        { signal: controller.signal },
      )
        .then(result => {
          if (!controller.signal.aborted) setSaved(current => current?.versionId === result.versionId ? result : current);
        })
        .catch(() => {});
    }, 1800);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [saved, endpoint]);
  const update = <K extends keyof EditorProblem>(
    key: K,
    value: EditorProblem[K],
  ) => setProblem((p) => ({ ...p, [key]: value }));
  const save = async (navigate=true) => {
    if (!editable) throw new Error("此题库仅授予阅读权限。");
    if (solutionPending) throw new Error(tr("请先保存或放弃题解修改，再保存题目。", "Save or discard solution changes before saving the problem."));
    if(!Number.isInteger(problem.timeLimitMs)||problem.timeLimitMs<100||problem.timeLimitMs>5000)throw new Error("时间限制须为 100–5000 ms 的整数。");
    if(!Number.isInteger(problem.memoryLimitMb)||problem.memoryLimitMb<32||problem.memoryLimitMb>256)throw new Error("内存限制须为 32–256 MB 的整数。");
    if(problem.mode==="function"&&problem.functionName&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(problem.functionName))throw new Error("函数名只能包含字母、数字与下划线，且不能以数字开头。");
    const tests = problem.tests ?? [];
    const body = {
      ...problem,
      saveDraft: true,
      ...(platform ? { expectedVersionId: saved?.versionId } : {}),
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
      saved ? `${endpoint}/${saved.id}/versions` : endpoint,
      { method: "POST", body },
    );
    draft.clear();
    setSaved(result);
    setProblem(result);
    setTagsText(null);
    if (!initial && navigate && !onClose)
      router.replace(
        `/teacher/problems/${result.id}/edit?${platform ? "source=platform&" : ""}returnTo=${encodeURIComponent(back)}${tab === "教程" ? "&tab=tutorial" : tab === "解答与提示" ? "&tab=solutions" : ""}`,
      );
    return result;
  };
  const list = (kind: "samples" | "tests") => problem[kind] ?? [];
  return (
    <div className={styles.editor} data-od-id="teacher-problem-editor">
      {onClose && <Button type="button" variant="ghost" disabled={stepDisabled} onClick={() => { if (window.dispatchEvent(new Event("campus-judge:before-navigate", { cancelable: true })) || window.confirm(tr("当前页面有未保存修改，确定返回吗？", "Discard unsaved changes and return?"))) onClose(); }}>{tr("返回题目列表", "Back to problems")}</Button>}
      {onClose && <h2 className="mt-2 break-words text-lg font-semibold">{problem.title || tr("新建题目", "New problem")}</h2>}
      <PageHeader
        eyebrow={tr("题目编辑", "Problem editor")}
        title={problem.title || tr("新建题目", "New problem")}
        description={`${platform ? "CodeMaster" : banks.data?.items.find((x) => x.id === problem.bankId)?.name ?? tr("尚未选择题库", "No bank selected")} · ${tr("草稿保存与发布分别进行，已发布版本及历史成绩保留。", "Saving a draft and publishing are separate. Published versions and past results remain.")}`}
        action={
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-5 gap-y-2">
            <ProblemEditorSteps navigation={steps} dirty={dirty || tutorialState.dirty} disabled={stepDisabled}
              onSelect={switchProblem} />
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPreview(true)}>
                <Eye size={15} />
                {tr("学生预览", "Student preview")}
              </Button>
              <Button
                disabled={action.busy || switching || solutionPending || !editable}
                onClick={() =>
                  void action.run(async () => {
                    await save();
                    return tr("草稿已保存，参考解验证结果在版本与发布页查看。", "Draft saved. Check reference validation under Versions and publication.");
                  })
                }
              >
                <Save size={15} />
                {tr("保存题目草稿", "Save problem draft")}
              </Button>
              {nextStep && <SaveAndEditNext target={nextStep} disabled={stepDisabled || tutorialState.dirty} onClick={() => {
                if (!dirty) { switchProblem(nextStep); return; }
                void action.run(async () => {
                  await save(false);
                  switchProblem(nextStep, true);
                  return tr("草稿已保存。", "Draft saved.");
                });
              }} />}
              {canPublish && <Button
                variant="secondary"
                disabled={action.busy || switching || solutionPending || !saved || dirty || !saved.canPublish}
                onClick={() => setPublish(true)}
              >
                <Send size={15} />
                {platform ? tr("发布版本", "Publish version") : bankVisibility === "school" ? tr("提交公开审核", "Request public review") : tr("启用教学版本", "Release for teaching")}
              </Button>}
            </div>
          </div>
        }
      />
      <Feedback action={action} />
      {switchError && <p role="alert" className="mt-3 text-sm text-destructive">{switchError}</p>}
      {nextStep && tutorialState.dirty && <p role="status" className="mt-2 text-sm text-muted-foreground">{tr("请先在“教程”中保存或放弃修改，再使用“保存并编辑下一题”。", "Save or discard your Tutorial changes before using Save and edit next.")}</p>}
      {solutionPending && <p role="status" className="mt-2 text-sm text-muted-foreground">{tr("题解有未保存修改或正在提交。请在“解答与提示”中完成保存，再保存题目草稿。", "Solution changes are unsaved or being submitted. Finish saving them under Solutions and hints before saving the problem draft.")}</p>}
      {draft.recovery&&<section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm" data-od-id="teacher-draft-recovery"><p>{tr("发现本机未保存草稿", "Unsaved local draft found")} · {new Date(draft.recovery.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")} {draft.recovery.baseVersion!==(initial?.versionId??"new")&&tr("（服务器版本已变化，请核对后保存）", "(The server version changed; review before saving)")}</p><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={!editable || action.busy || switching} onClick={draft.restore}>{tr("恢复草稿", "Restore draft")}</Button><Button size="sm" variant="ghost" disabled={action.busy || switching} onClick={draft.discard}>{tr("忽略草稿", "Discard draft")}</Button></div></section>}
      {draft.status&&<p className="mt-2 text-xs text-muted-foreground" role="status" data-od-id="teacher-autosave-status">{draft.status}</p>}

      <div className={styles.toolbar}>
        {!platform && <><span className="text-muted-foreground">{tr("分组", "Groups")}</span>
        <GroupTags
          onClick={saved?.id && editable && !stepDisabled ? () => setManage(true) : undefined}
          groups={
            groups.data?.items.filter((g) =>
              g.problemIds.includes(saved?.id ?? ""),
            ) ?? []
          }
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!editable || stepDisabled}
          onClick={() => {if(saved?.id && saved.bankId===problem.bankId)setManage(true);else void action.run(async()=>{await save(false);setManage(true);return "草稿已保存，可选择分组。";});}}
        >
          {tr("整理分组", "Organize groups")}
        </Button></>}
        {saved && !platform ? <ProblemPublicationStatus problem={saved} bankVisibility={bankVisibility}/> : <StatusPill status={saved?.published ? tr("已发布", "Published") : tr("草稿", "Draft")}/>}
        {saved && !platform && <span className="text-xs text-muted-foreground">{reviewVisibilityLabel(saved, bankVisibility, locale)}</span>}
        {dirty && <span className="text-xs text-warning">{tr("有未保存修改", "Unsaved changes")}</span>}
      </div>
      {!platform && !saved?.id&&<p className="text-xs text-muted-foreground">{tr("整理分组时先保存题目草稿；没有分组可在弹窗中直接新建。", "Save the problem draft before organizing groups. You can create a group in the dialog.")}</p>}
      <State resource={groups}/>
      <Tabs value={tr(tab, englishTabs[tab] ?? tab)} onChange={value => {
        const next = visibleTabs.find(item => tr(item, englishTabs[item] ?? item) === value) ?? "题面";
        if (next === "教程") setTutorialVisited(true);
        if (next === "解答与提示") setSolutionsVisited(true);
        setTab(next);
      }} items={visibleTabs.map(item => tr(item, englishTabs[item] ?? item))} />
      <section className={`${panel} ${styles.body}`} hidden={tab === "教程" || tab === "解答与提示"} data-od-id="teacher-editor-tab-content"><fieldset disabled={!editable || action.busy || switching || solutionPending}>
        {tab === "题面" && (
          <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-5 max-lg:grid-cols-1">
            <div className="space-y-4">
              <Field label={tr("题目标题", "Problem title")}>
                <input
                  autoFocus
                  value={problem.title}
                  disabled={!editable}
                  onChange={(e) => update("title", e.target.value)}
                  className={input}
                />
              </Field>
              <MathEditor fieldName="statement" label={tr("题面 / Markdown 与 LaTeX", "Statement / Markdown and LaTeX")} value={problem.statement} disabled={!editable} onChange={value=>update("statement",value)} rows={10} initialPreview/>

            </div>
            <aside className="space-y-4">
              {platform && <p className="text-sm text-muted-foreground">{tr("来源", "Source")}: <span className="font-semibold">CodeMaster</span></p>}
              <Field label={platform ? tr("平台分类", "Platform category") : tr("所属题库", "Problem bank")}>
                {platform ? saved || !user.platformAdmin ? <p className="py-2 text-sm">{problem.bankName || tr("未分类", "Unclassified")}</p> : <select name="platformCategory" aria-label={tr("平台分类", "Platform category")} value={problem.bankId ?? ""} disabled={!editable || banks.loading} onChange={event => update("bankId", event.target.value)} className={input}><option value="">{tr("未分类", "Unclassified")}</option>{banks.data?.items.map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select> : <select
                  value={problem.bankId ?? ""}
                  disabled={!!saved || !editable}
                  onChange={(e) => update("bankId", e.target.value)}
                  className={input}
                >
                  <option value="">{tr("请选择题库", "Choose a bank")}</option>
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
                </select>}
              </Field>
              {platform && user.platformAdmin && <State resource={banks} />}
              <div>
                <Field label={tr("主题标签", "Topic tags")}>
                  <input
                    name="tags"
                    value={tagsText ?? problem.tags?.join(", ") ?? ""}
                    aria-describedby={tagsHintId}
                    disabled={!editable}
                    onChange={event => {
                      const value = event.target.value;
                      setTagsText(value);
                      update("tags", value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean));
                    }}
                    className={input}
                  />
                </Field>
                <span id={tagsHintId} className="mt-1 block text-xs text-muted-foreground">
                  {tr("用逗号分隔标签，标签内可以有空格。", "Separate tags with commas. Tags can contain spaces.")}
                </span>
              </div>
              <Field label={tr("难度", "Difficulty")}>
                <select
                  value={problem.difficulty ?? "基础"}
                  onChange={(e) => update("difficulty", e.target.value)}
                  className={input}
                >
                  {["基础", "中等", "进阶"].map((x) => (
                    <option key={x} value={x}>{tr(x, ({"基础":"Basic","中等":"Intermediate","进阶":"Advanced"} as Record<string,string>)[x] ?? x)}</option>
                  ))}
                </select>
              </Field>
              <Field label={tr("题目来源", "Source")}>
                <input
                  value={problem.source ?? ""}
                  onChange={(e) => update("source", e.target.value)}
                  className={input}
                />
              </Field>
              <section className="border border-border bg-surface-subtle p-4 text-xs leading-6 text-muted-foreground">
                {tr("题面支持普通文本与 Markdown。图片链接应来自可访问的课程资料；正式测试与参考代码只向维护教师开放。", "Statements support plain text and Markdown. Image links should point to accessible course material. Formal tests and reference code are visible only to maintaining teachers.")}
              </section>
            </aside>
          </div>
        )}
        {tab === "接口与模板" && (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {tr("接口类型", "Interface type")}
              </p>
              <div className="mt-2 flex gap-2">
                {(["stdio", "function"] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant={problem.mode === mode ? "primary" : "secondary"}
                    disabled={!editable}
                    onClick={() => update("mode", mode)}
                  >
                    {mode === "stdio" ? tr("标准输入输出", "Standard I/O") : tr("函数题", "Function")}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {tr("切换接口保留测试内容；请在测试数据页检查参数与期望返回值格式。", "Changing the interface retains tests. Check parameter and expected-return formats under Test data.")}
              </p>
            </div>
            {problem.mode === "function" ? (
              <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                <Field label={tr("函数名", "Function name")}>
                  <input
                    value={problem.functionName ?? ""}
                    onChange={(e) => update("functionName", e.target.value)}
                    className={input}
                  />
                </Field>
                <Field label={tr("参数说明", "Parameter description")}>
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
                <Field label={tr("返回类型", "Return type")}>
                  <input
                    value={problem.returnType ?? ""}
                    onChange={(e) => update("returnType", e.target.value)}
                    className={input}
                  />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                <MathEditor fieldName="input-description" label={tr("输入说明", "Input description")} value={problem.inputDescription ?? ""} disabled={!editable} onChange={value=>update("inputDescription",value)} rows={4}/>
                <MathEditor fieldName="output-description" label={tr("输出说明", "Output description")} value={problem.outputDescription ?? ""} disabled={!editable} onChange={value=>update("outputDescription",value)} rows={4}/>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
              <section className="min-w-0 space-y-3">
                <Field label={tr("学生模板语言", "Student template language")}>
                  <select aria-label={tr("学生模板语言", "Student template language")} value={templateLanguage} onChange={e => setTemplateLanguage(e.target.value as SubmissionLanguage)} className={input}>
                    <option value="python">Python</option><option value="cpp">C++</option><option value="javascript">JavaScript</option>
                  </select>
                </Field>
                <CodeField language={templateLanguage} label={tr("学生起始模板", "Student starter template")} value={templateLanguage === "python" ? problem.starterCode : problem.starterCodes?.[templateLanguage] ?? ""} onChange={value => templateLanguage === "python" ? update("starterCode", value) : update("starterCodes", { ...problem.starterCodes, [templateLanguage]: value })} />
                <p className="text-xs text-muted-foreground">{tr("各语言模板独立保存，留空时由系统生成。", "Templates are saved per language; empty templates are generated by the system.")}</p>
                {problem.mode === "function" && templateLanguage === "cpp" && <CppFunctionSignature name={problem.functionName} />}
              </section>
              <section className="min-w-0 space-y-3">
                <Field label={tr("参考解答语言", "Reference solution language")}>
                  <select aria-label={tr("参考解答语言", "Reference solution language")} value={problem.referenceLanguage ?? "python"} onChange={e => update("referenceLanguage", e.target.value as SubmissionLanguage)} className={input}>
                    <option value="python">Python</option><option value="cpp">C++</option><option value="javascript">JavaScript</option>
                  </select>
                </Field>
                <CodeField language={problem.referenceLanguage ?? "python"} label={tr("判题参考代码", "Reference code for validation")} value={problem.referenceCode ?? ""} onChange={value => update("referenceCode", value)} />
                <p className="text-xs leading-5 text-muted-foreground">{tr("系统用这段代码核对启用的正式测试。此字段仅供维护人员查看。可在「解答与提示」中导入代码，经审核后发布给学生。", "The judge runs this code against enabled formal tests. Only problem maintainers can see this field. To share it with students, import it into Solutions and hints and publish it after review.")}</p>
                <p className="text-xs text-muted-foreground">{tr("切换语言只更改验证运行时，参考代码需手动更新。", "Switching languages changes the validation runtime. Update the reference code yourself.")}</p>
                {problem.mode === "function" && problem.referenceLanguage === "cpp" && <CppFunctionSignature name={problem.functionName} />}
              </section>
            </div>

          </div>
        )}
        {tab === "测试数据" && (
          <div className="space-y-6">
            {(["samples", "tests"] as const).map((kind) => (
              <section key={kind} className="border border-border">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-subtle px-4 py-3">
                  <div>
                    <h3 className="font-bold">
                      {kind === "samples" ? tr("公开样例", "Public samples") : tr("正式测试", "Formal tests")} ·{" "}
                      {list(kind).length}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {kind === "samples"
                        ? tr("学生可见，不计入正式得分。", "Visible to students; excluded from formal scoring.")
                        : tr("一个输入与一个期望结果构成一个测试点；隐藏输入与期望答案不会显示给学生。", "One input and one expected result form a test case. Hidden inputs and answers are not shown to students.")}
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
                        {tr("批量导入", "Bulk import")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!editable}
                      onClick={() => setTest({ kind, index: null })}
                    >
                      <Plus size={14} />
                      {tr("添加", "Add")}
                    </Button>
                  </div>
                </div>
                <Table
                  headers={[
                    tr("编号 / 名称", "ID / name"),
                    problem.mode === "function" ? tr("参数", "Parameters") : tr("输入", "Input"),
                    problem.mode === "function" ? tr("期望返回值", "Expected return") : tr("期望输出", "Expected output"),
                    tr("启用", "Enabled"),
                    tr("操作", "Actions"),
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
                            `${kind === "samples" ? tr("样例", "Sample") : tr("测试", "Test")} ${i + 1}`}
                        </p>
                      </td>
                      <td className="max-w-52">
                        <pre className="truncate font-mono text-xs">
                          {item.input || tr("合法空输入", "Valid empty input")}
                        </pre>
                      </td>
                      <td className="max-w-52">
                        <pre className="truncate font-mono text-xs">
                          {item.expected || tr("合法空输出", "Valid empty output")}
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
                          {item.enabled !== false ? tr("启用", "Enabled") : tr("停用", "Disabled")}
                        </button>
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title={tr("编辑测试", "Edit test")}
                            disabled={!editable}
                            onClick={() => setTest({ kind, index: i })}
                          >
                            <Pencil size={15} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title={tr("复制测试", "Copy test")}
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
                            title={tr("删除测试", "Delete test")}
                            disabled={!editable}
                            onClick={() => {
                              if (
                                window.confirm(
                                  tr("从当前草稿删除这条测试？已发布版本保留。", "Delete this test from the current draft? Published versions remain."),
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
                      {tr("尚无", "No")} {kind === "samples" ? tr("公开样例", "public samples") : tr("正式测试", "formal tests")}
                      {tr("。点击“添加”创建第一条。", ". Click Add to create the first one.")}
                    </Empty>
                  )}
                </Table>
              </section>
            ))}
          </div>
        )}
        {tab === "判题设置" && (
          <div className="space-y-4">
            <div className={styles.summary}><div><strong>{problem.mode==="function"?tr("函数题","Function"):tr("标准输入输出","Standard I/O")}</strong><span>{tr("题目接口","Problem interface")}</span></div><div><strong>{(problem.tests??[]).filter(x=>x.enabled!==false).length} / {(problem.tests??[]).length}</strong><span>{tr("启用 / 全部正式测试","Enabled / all formal tests")}</span></div><div><strong>Python · C++ · JavaScript</strong><span>{tr("学生可用语言，参考解验证使用所选语言","Student languages; reference validation uses the selected language")}</span></div></div>
            <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
              <Field label={tr("参考解验证语言","Reference validation language")}><select className={input} value={problem.referenceLanguage??"python"} onChange={e=>update("referenceLanguage",e.target.value as SubmissionLanguage)}><option value="python">Python</option><option value="cpp">C++</option><option value="javascript">JavaScript</option></select></Field>
              <Field label={tr("时间限制（ms）","Time limit (ms)")}><input type="number" step={1} min={100} max={5000} value={problem.timeLimitMs} onChange={e=>update("timeLimitMs",Number(e.target.value))} className={input}/><p className="mt-1 text-xs text-muted-foreground">{tr("100–5000 ms，亦受运行环境上限约束。","100–5000 ms, subject to runtime limits.")}</p></Field>
              <Field label={tr("内存限制（MB）","Memory limit (MB)")}><input type="number" step={1} min={32} max={256} value={problem.memoryLimitMb} onChange={e=>update("memoryLimitMb",Number(e.target.value))} className={input}/><p className="mt-1 text-xs text-muted-foreground">{tr("32–256 MB；JavaScript 最低按 128 MB 执行。","32–256 MB; JavaScript uses at least 128 MB.")}</p></Field>
              <Field label={tr("输出比较方式","Output comparison")}><select aria-label={tr("输出比较方式","Output comparison")} disabled={problem.mode==="function"} className={input} value={problem.mode==="function"?"json":problem.comparator==="exact"?"exact":"tokens"} onChange={e=>update("comparator",e.target.value as EditorProblem["comparator"])}>{problem.mode==="function"?<option value="json">{tr("JSON 返回值比较","JSON return-value comparison")}</option>:<><option value="tokens">{tr("按 token 比较（忽略空白差异）","Token comparison (ignore whitespace)")}</option><option value="exact">{tr("精确文本比较","Exact text comparison")}</option></>}</select><p className="mt-1 text-xs text-muted-foreground">{tr("函数题由系统固定使用 JSON 比较。","Function problems always use JSON comparison.")}</p></Field>
              <Field label={tr("测试计分","Test scoring")}><div className="rounded-md border border-border px-3 py-2 text-sm">{tr("启用的正式测试点等权计分","Enabled formal test cases have equal weight")}</div><p className="mt-1 text-xs text-muted-foreground">{tr("公开样例不计分，活动得分按作业或训练规则计算。","Public samples do not score. Activity points follow assignment or practice rules.")}</p></Field>
              <div className="flex flex-wrap items-start gap-2"><Button variant="secondary" onClick={()=>setTab("测试数据")}>{tr("管理测试数据","Manage test data")}</Button><Button variant="secondary" disabled={!editable||action.busy||solutionPending} onClick={()=>void action.run(async()=>{await save();setTab("版本与发布");return tr("草稿已保存，请查看参考解验证结果。","Draft saved. Check reference validation results.");})}>{tr("验证参考解","Validate reference solution")}</Button></div>
            </div>
          </div>
        )}
        {tab === "版本与发布" && (
          <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 max-lg:grid-cols-1">
            <section className="space-y-4">
              <div className="border border-border p-4">
                <h3 className="font-bold">{tr("当前版本", "Current version")}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {tr("保存草稿与发布分别进行。已发布题目的修改不会覆盖历史作业仍在使用的旧版本。", "Draft saving and publication are separate. Changes to published problems do not overwrite versions used by past assignments.")}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{platform ? tr("由平台管理员发布题目版本并设置公开范围。授权编辑者可以保存修改，等待管理员发布。", "Platform administrators publish versions and manage visibility. Authorized editors save changes for administrator publication.") : bankVisibility === "school" ? tr("发布到校内题库后自动进入管理员审核；审核通过前，仅负责教师及指定作业或训练学生可见，不计入积分排行榜。", "Publishing to a school bank starts admin review. Until approval, only the responsible teacher and assigned students can access it; it earns no leaderboard points.") : tr("当前为教师私有题库。题目发布后可用于指定作业或训练；如需全校开放，请联系管理员纳入校内审核。", "This is a private teacher bank. Published problems can be used in assigned activities. Ask an administrator for school-wide review.")}</p>
                {saved && !platform && <p className="mt-2 text-sm font-medium">{tr("当前状态", "Current status")}: {reviewVisibilityLabel(saved, bankVisibility, locale)}</p>}
                <p className="mt-3 font-mono text-xs">
                  {saved?.versionId ?? tr("尚未保存", "Not saved")}
                </p>
              </div>
              <div className="border border-border">
                <div className="bg-surface-subtle px-4 py-3 font-bold">
                  {tr("发布检查", "Publication checklist")}
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
                  ["参考解验证", saved?.validationStatus === "AC"],
                ].map(([label, ok]) => (
                  <div
                    key={String(label)}
                    className="flex justify-between border-t border-border px-4 py-3 text-sm"
                  >
                    <span>{tr(String(label), ({"题面":"Statement","接口":"Interface","正式测试":"Formal tests","参考解验证":"Reference validation"} as Record<string,string>)[String(label)] ?? String(label))}</span>
                    <span className={ok ? "text-success" : "text-warning"}>
                      {ok ? tr("完整", "Complete") : tr("待完善", "Incomplete")}
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
              <StatusPill status={validationStatusLabel(saved?.validationStatus ?? "Draft", locale)} />
              <Button variant="secondary" onClick={() => setImpact(true)}>
                {tr("查看版本影响", "View version impact")}
              </Button>
              <Button
                variant="secondary"
                disabled={!saved || action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const result = await productionApi<EditorProblem>(
                      `${endpoint}/${saved?.id}?versionId=${saved?.versionId}`,
                    );
                    setSaved(result);
                    return tr("验证结果已刷新。", "Validation result refreshed.");
                  })
                }
              >
                {tr("刷新验证结果", "Refresh validation")}
              </Button>
              {canPublish && <Button
                variant="secondary"
                disabled={!editable || !saved?.canPublish || dirty || action.busy || solutionPending}
                onClick={() => setPublish(true)}
              >
                {platform ? tr("发布版本", "Publish version") : bankVisibility === "school" ? tr("提交公开审核", "Request public review") : tr("启用教学版本", "Release for teaching")}
              </Button>}
            </aside>
          </div>
        )}
      </fieldset></section>
      {solutionsVisited && <section className="space-y-4" role="tabpanel" aria-label={tr("解答与提示", "Solutions and hints")} hidden={tab !== "解答与提示"}>
        {saved?.versionId && editable ? <ProblemAssistanceEditor key={saved.id}
          problemId={saved.id} versionId={saved.versionId}
          endpoint={platform ? `${endpoint}/${saved.id}/contents` : undefined} canPublish={canPublish}
          initialVersionId={search.get("solutionVersionId") ?? undefined}
          initialKind={search.get("kind") === "FULL_TRANSLATION" ? "FULL_TRANSLATION" : "FULL_SOLUTION"}
          externalBusy={action.busy || switching} hasUnsavedProblemChanges={dirty} onPendingChange={setSolutionPending} />
          : <p className={`${panel} p-4 text-sm text-muted-foreground`}>{saved
            ? tr("你对此题只有查看权限，无法编辑或发布学生题解。", "You have read-only access to this problem and cannot edit or publish student solutions.")
            : tr("先保存题目草稿，即可在这里修改学生题解、添加多种解法并审核发布。", "Save the problem draft first, then edit student solutions, add approaches and review them for publication here.")}</p>}
        <details className={`${panel} p-4`} open={!saved || undefined}>
          <summary className="cursor-pointer font-semibold">{tr("判题参考代码与提示", "Reference validation code and hints")}</summary>
          <p className="my-3 text-sm text-muted-foreground">{tr("这里的代码用于验证题目，素材与提示随题目草稿保存。学生阅读的题解在上方单独保存并审核发布。", "This code validates the problem. Notes and hints are saved with the problem draft. Save and review student-facing solutions separately above.")}</p>
          <fieldset disabled={!editable || action.busy || switching}>
          <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-5 max-lg:grid-cols-1">
            <div className="space-y-4">
              <CodeField
                language={problem.referenceLanguage ?? "python"}
                label={tr("参考代码", "Reference code")}
                value={problem.referenceCode ?? ""}
                onChange={(v) => update("referenceCode", v)}
              />
              <p className="text-xs text-muted-foreground">{tr("此参考代码用于题目验证，可在学生题解中导入并审核发布。修改此处不会替换已经发布的学生答案。", "This reference code is used to validate the problem. It can be imported into student solutions for review. Changes here do not replace published student answers.")}</p>
              <MathEditor fieldName="editorial" label={tr("教师题解草稿", "Teacher solution notes")} value={problem.editorial ?? ""} disabled={!editable} onChange={value=>update("editorial",value)} rows={5}/>
              <p className="text-xs text-muted-foreground">{tr("在此整理题解素材。学生当前看到的完整题解请直接在上方编辑；此字段为空不代表没有已发布题解。", "Use this field to prepare solution notes. Edit the full solution students are reading directly above; an empty field here does not mean no solution has been published.")}</p>
            </div>
            <aside className="space-y-4">
              <Field label={tr("分级提示", "Progressive hints")}>
                <textarea
                  value={metadataText(problem.hints)}
                  onChange={(e) =>
                    update("hints", e.target.value.split("\n").filter(Boolean))
                  }
                  rows={8}
                  className={area}
                />
              </Field>
              <Field label={tr("开放策略", "Release policy")}>
                <select
                  value={problem.hintPolicy ?? "afterAC"}
                  onChange={(e) => update("hintPolicy", e.target.value)}
                  className={input}
                >
                  <option value="afterAC">{tr("通过正式提交后开放", "After a formal AC")}</option>
                  <option value="always">{tr("始终可见", "Always visible")}</option>
                  <option value="never">{tr("不开放", "Never visible")}</option>
                </select>
              </Field>
              <Button
                disabled={action.busy || solutionPending || !editable}
                onClick={() =>
                  void action.run(async () => {
                    await save();
                    setTab("版本与发布");
                    return tr("参考解验证任务已提交。", "Reference validation job submitted.");
                  })
                }
              >
                <Send size={15} />
                {tr("检查参考解答", "Check reference solution")}
              </Button>
            </aside>
          </div>

          </fieldset>
        </details>
      </section>}
      {showTutorial && tutorialVisited && <section className={`${panel} ${styles.body}`}
        role="tabpanel" aria-label={tr("教程", "Tutorial")} hidden={tab !== "教程"}>
        {saved ? <ProblemTutorialEditor key={saved.id} endpoint={`${endpoint}/${encodeURIComponent(saved.id)}/tutorial`} inline disabled={action.busy || switching} onEditStateChange={setTutorialState} /> :
          <p className="text-sm text-muted-foreground">{tr("先保存题目草稿，即可在这里设置教程。", "Save the problem draft to set up its tutorial here.")}</p>}
      </section>}
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
      {!platform && manage && saved?.bankId && (
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
        <Modal title={tr("版本影响", "Version impact")} onClose={() => setImpact(false)}>
          <p className="text-sm leading-7">
            {tr("发布后，新练习使用新的已发布版本。作业、计时训练、原提交和订正继续使用各自固定的版本。重判、发布成绩与版本发布分别进行。", "After publishing, new practice uses the new version. Assignments, timed practices, original submissions, and corrections keep their fixed versions. Rejudging, result publication, and version publication are separate actions.")}
          </p>
        </Modal>
      )}
      {canPublish && publish && saved && (
        <Modal title={platform ? tr("发布版本", "Publish version") : bankVisibility === "school" ? tr("提交公开审核", "Request public review") : tr("启用教学版本", "Release for teaching")} onClose={() => setPublish(false)}>
          <p className="text-sm leading-6">
            {tr("发布", "Publish")} “{saved.title}” {tr("的已验证版本。历史活动与提交保留原版本。", "as a validated version. Past activities and submissions keep the earlier version.")} {platform ? tr("课程与普通练习使用最新已发布版本。公开范围由平台管理员在题库中另行设置。", "Courses and ordinary practice use the latest published version. Platform administrators manage public visibility separately in the problem bank.") : bankVisibility === "school" ? tr("本版本将进入管理员审核；通过前仅指定活动学生可见，也不会计入全校排名积分。", "This version enters admin review. Until approved, it is visible only to assigned activity students and earns no leaderboard points.") : tr("当前题库为教师私有，仅指定活动学生可见；如需全校开放，须由管理员调整题库范围并审核该版本。", "This bank is teacher-private and visible only to assigned activity students. An administrator must adjust the bank scope and approve this version for school-wide access.")}
          </p>
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPublish(false)}>
              {tr("取消", "Cancel")}
            </Button>
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const result = await productionApi<EditorProblem>(
                    `${endpoint}/${saved.id}/publish`,
                    { method: "POST", body: platform ? { expectedVersionId: saved.versionId } : { versionId: saved.versionId } },
                  );
                  setSaved(result);
                  setProblem(result);
                  setTagsText(null);
                  setPublish(false);
                  return platform ? tr("题目版本已发布。", "Problem version published.") : tr("题目版本已发布；全校开放和积分资格须经管理员审核。", "Problem version published. School-wide access and point eligibility require admin review.");
                })
              }
            >
              {bankVisibility === "school" ? tr("提交审核", "Request review") : tr("启用版本", "Release version")}
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
function CppFunctionSignature({ name }: { name?: string }) {
  const { locale } = useLocale();
  return <p className="text-xs leading-5 text-muted-foreground">
    {locale === "zh" ? "C++ 函数签名" : "C++ function signature"}{" "}
    <code className="font-mono [overflow-wrap:anywhere]">{`nlohmann::json ${name || "solve"}(nlohmann::json& args, nlohmann::json& kwargs)`}</code>
  </p>;
}

function CodeField({label,value,onChange,language="python"}:{label:string;value:string;onChange:(value:string)=>void;language?:SubmissionLanguage}){
 const pageTheme=useWorkspaceTheme();
 const {locale}=useLocale();
 const isReference=label.includes("参考")||label.toLowerCase().includes("reference");
 return <Field label={label}><div className="flex justify-end"><CopyCodeButton code={value}/></div><div className={styles.code} data-od-id={`teacher-code-${isReference?"reference":language}`}><CodeEditor idPrefix={`teacher-${isReference?"reference":language}`} inputLabel={label} status={locale==="zh"?"修改后需保存草稿":"Save draft after editing"} code={value} onChange={onChange} language={language} settings={{...defaultWorkspaceSettings,theme:pageTheme==="dark"?"vs_dark":"vs",fontSize:13}}/></div></Field>;
}
function ProblemPreview({
  problem,
  onClose,
}: {
  problem: EditorProblem;
  onClose: () => void;
}) {
  const {locale}=useLocale();
  const tr=(zh:string,en:string)=>locale==="zh"?zh:en;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="sticky top-0 flex justify-between border-b border-border bg-surface p-4">
        <div>
          <b>{tr("学生预览", "Student preview")} · {problem.title || tr("未命名题目", "Untitled problem")}</b>
          <p className="text-xs text-muted-foreground">
            {tr("仅展示题面、公开样例与学生模板", "Shows only the statement, public samples, and student template")}
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          ← {tr("返回编辑", "Back to editor")}
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
                <h2 className="font-bold">{tr("样例", "Sample")} {i + 1}</h2>
                <pre className="mt-3 whitespace-pre-wrap rounded bg-code p-3 text-xs text-code-foreground">
                  {tr("输入 / 参数", "Input / Parameters")}{"\n"}
                  {sample.input}
                  {"\n\n"}{tr("输出 / 返回值", "Output / Return")}{"\n"}
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
