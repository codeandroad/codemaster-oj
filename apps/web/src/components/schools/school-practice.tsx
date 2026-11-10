"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpen, History, Languages, Lightbulb, RefreshCw, Settings } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MathContent } from "@/components/math-content";
import { apiMessage, productionApi, type CampusUser } from "@/lib/production-api";
import problemStyles from "@/components/student/problems-page.module.css";
import { ProblemCatalogSearch } from "@/components/student/problem-catalog-search";
import { CodeEditor } from "@/components/student/code-editor";
import { CopyCodeButton } from "@/components/student/copy-code-button";
import { ProblemSubmissionsTable, SolvedStatus, useProblemSubmissions } from "@/components/student/problem-submissions";
import { ProblemTutorial, useProblemTutorial } from "@/components/student/problem-tutorial";
import { ProblemTutorialEditor } from "@/components/teacher/problem-tutorial-editor";
import { RunResultPanel } from "@/components/student/run-result-panel";
import { useWorkspaceSettings, WorkspaceSettingsDialog } from "@/components/student/workspace-settings";
import { Feedback, State, input, textarea, useData, useMutation, type DetailedSubmission } from "@/components/student/shared";
import type { ResultCase } from "@/components/student/result-feedback";
import { SchoolAssistance, SchoolActivityScholarshipRule } from "./school-scholarship";
import { LearnerProblemTable, SchoolPracticeCatalog } from "./school-practice-catalog";
import type { Bank, Problem } from "./school-practice-types";
import { SchoolProblemEditor } from "./school-problem-editor";
import { practiceCatalogFilters, practiceFilterKeys, practiceLocation, practiceNavigationItems, type PracticeCatalogFilters } from "./school-practice-navigation";
import { PublicProblemWorkspace } from "./public-problem-workspace";
import { PracticeToolbar, type PracticeNavigation } from "./school-practice-toolbar";

type Job=DetailedSubmission&{state:string;caseFeedback:ResultCase[]};

function updatePracticeLocation(patch: Record<string, string | null>, replace = false) {
  const current = window.location;
  const href = practiceLocation(current.pathname, current.search, patch, current.hash);
  if (href === `${current.pathname}${current.search}${current.hash}`) return;
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}

export function SchoolPractice(props: { schoolId: string; role: string; initialProblemId?: string }) {
  return <SchoolPracticeContents key={`${props.schoolId}:${props.role}:${props.initialProblemId ?? "list"}`} {...props} />;
}

function SchoolPracticeContents({ schoolId, role, initialProblemId }: { schoolId: string; role: string; initialProblemId?: string }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const base = `schools/${schoolId}`;
  const search = useSearchParams();
  const staff = role === "teacher" || role === "school_admin";
  const filters = practiceCatalogFilters(search, staff);
  const { bankId } = filters;
  const banks = useData<{ items: Bank[] }>(`${base}/problem-banks`);
  const allProblems = useData<{ items: Problem[] }>(`${base}/problems`);
  const bankProblems = useData<{ items: Problem[] }>(bankId ? `${base}/problems?bankId=${encodeURIComponent(bankId)}` : "");
  const problems = bankId ? bankProblems : allProblems;
  const selected = search.get("problemId") ?? initialProblemId ?? null;
  const [editing, setEditing] = useState<Problem | "new" | null>(null);
  const [bankEdit, setBankEdit] = useState<Bank | "new" | null>(null);
  const [bankName, setBankName] = useState("");
  const bankRequest = useRef("");
  const bankPending = useRef(false);
  const action = useMutation();
  function refresh() { banks.reload(); allProblems.reload(); bankProblems.reload(); }
  function selectProblem(problemId: string | null) { updatePracticeLocation({ problemId }); }
  function changeFilters(patch: Partial<PracticeCatalogFilters>) {
    const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [practiceFilterKeys[key as keyof PracticeCatalogFilters], typeof value === "boolean" ? value ? "1" : null : value]));
    updatePracticeLocation(fields, true);
  }
  function editProblem(problem: Problem) {
    void action.run(async () => setEditing(await productionApi<Problem>(`${base}/problems/${problem.id}`)));
  }
  function editBank(bank: Bank | "new") {
    action.reset();
    setBankName(bank === "new" ? "" : bank.name);
    bankRequest.current = crypto.randomUUID();
    setBankEdit(bank);
  }
  useEffect(() => {
    if (!problems.data?.items.some(problem => ["queued", "leased"].includes(problem.validation?.state ?? ""))) return;
    const timer = setInterval(problems.reload, 2000);
    return () => clearInterval(timer);
  }, [problems.data, problems.reload]);

  if (selected) return <PracticeProblem key={`${schoolId}:${selected}`} path={`${base}/problems/${encodeURIComponent(selected)}`} jobPath={id => `${base}/judge-jobs/${id}`} onBack={() => { selectProblem(null); refresh(); }} navigation={{ currentId: selected, items: practiceNavigationItems(allProblems.data?.items ?? [], filters, staff, selected, banks.data?.items.filter(bank => bank.archived).map(bank => bank.id)), onSelect: selectProblem }} />;

  return <div className="space-y-3">
    <Feedback action={action} />
    <State data={banks}><State data={problems}>
      <SchoolPracticeCatalog
        banks={banks.data?.items ?? []}
        problems={problems.data?.items ?? []}
        allProblems={allProblems.data?.items ?? []}
        role={role}
        filters={filters}
        onFiltersChange={changeFilters}
        busy={action.busy}
        onRefresh={refresh}
        onEditBank={editBank}
        onNewProblem={() => setEditing("new")}
        onOpen={id => {
          const problem = problems.data?.items.find(item => item.id === id);
          if (staff && problem?.canManage) editProblem(problem);
          else selectProblem(id);
        }}
        renderActions={problem => <>
          {problem.canManage && <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => editProblem(problem)}>{tx("编辑", "Edit")}</Button>}
          {problem.canManageTutorial && <ProblemTutorialEditor
            endpoint={`${base}/problems/${encodeURIComponent(problem.id)}/tutorial`}
            problemTitle={problem.title}
            size="sm"
            variant="ghost"
            disabled={action.busy}
          />}
          {problem.canManage && <>
            <Button size="sm" variant="secondary" title={tx("验证参考程序", "Validate reference program")} disabled={action.busy || ["queued", "leased"].includes(problem.validation?.state ?? "")} onClick={() => void action.run(async () => {
              await productionApi(`${base}/problems/${problem.id}/validate`, { method: "POST", body: { expectedRevision: problem.revision, requestId: crypto.randomUUID() } }); refresh();
            })}>{tx("验证", "Validate")}</Button>
            {role === "school_admin" && (!problem.published || problem.hasDraftChanges) && <Button size="sm" disabled={action.busy || problem.validation?.status !== "AC"} onClick={() => void action.run(async () => {
              await productionApi(`${base}/problems/${problem.id}/publish`, { method: "POST", body: { expectedRevision: problem.revision } }); refresh();
            })}>{tx("审核发布", "Review & publish")}</Button>}
            {problem.published && <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void action.run(async () => {
              await productionApi(`${base}/problems/${problem.id}/unpublish`, { method: "POST", body: { expectedRevision: problem.revision } }); refresh();
            })}>{tx("下架", "Unpublish")}</Button>}
          </>}
          {role === "school_admin" && problem.published && problem.versionId &&
            !banks.data?.items.find(bank => bank.id === problem.bankId)?.archived && (
            problem.platformPublished ? <span className="px-2 text-xs text-success">{tx("已公开", "Public")}</span>
              : <Button size="sm" variant="ghost" disabled={action.busy || problem.publicRequestStatus === "pending"}
                onClick={() => void action.run(async () => {
                  await productionApi(`${base}/problems/${problem.id}/public-request`, { method: "POST", body: { versionId: problem.versionId } });
                  refresh();
                })}>
                {problem.publicRequestStatus === "pending" ? tx("待平台审核", "Awaiting review")
                  : problem.publicRequestStatus === "rejected" ? tx("被退回 · 重新申请", "Rejected · Request again")
                    : tx("申请平台公开", "Request public release")}
              </Button>
          )}
          {problem.published && !banks.data?.items.find(bank => bank.id === problem.bankId)?.archived && <Button size="sm" variant="ghost" onClick={() => selectProblem(problem.id)}>{tx("练习", "Practice")}</Button>}
        </>}
      />
    </State></State>
    <Dialog open={bankEdit !== null} onOpenChange={open => { if (!open && !bankPending.current) setBankEdit(null); }}>
      <DialogContent>
        <DialogTitle>{bankEdit === "new" ? tx("新建题库", "New bank") : tx("编辑题库", "Edit bank")}</DialogTitle>
        <DialogDescription>{tx("使用简明名称组织本校题目。", "Use a short name to organize this school's problems.")}</DialogDescription>
        <form noValidate className="space-y-3" onSubmit={event => {
          event.preventDefault();
          if (bankPending.current) return;
          bankPending.current = true;
          void action.run(async () => {
            if (!bankName.trim()) throw new Error(tx("请输入题库名称。", "Enter a bank name."));
            await productionApi(`${base}/problem-banks${bankEdit && bankEdit !== "new" ? `/${bankEdit.id}` : ""}`, {
              method: bankEdit === "new" ? "POST" : "PATCH",
              body: { name: bankName.trim(), requestId: bankRequest.current, expectedRevision: bankEdit && bankEdit !== "new" ? bankEdit.revision : undefined },
            });
            setBankEdit(null); refresh();
          }).finally(() => { bankPending.current = false; });
        }}>
          <label className="block text-sm font-medium">{tx("题库名称", "Bank name")}<input className={`${input} mt-1`} value={bankName} onChange={event => { setBankName(event.target.value); bankRequest.current = crypto.randomUUID(); }} disabled={action.busy} required maxLength={120} /></label>
          <Feedback action={action} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={action.busy} onClick={() => setBankEdit(null)}>{tx("取消", "Cancel")}</Button><Button disabled={action.busy}>{action.busy ? tx("保存中…", "Saving…") : tx("保存", "Save")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    {editing && <SchoolProblemEditor key={editing === "new" ? "new" : editing.id} problem={editing === "new" ? null : editing} banks={banks.data?.items.filter(bank => bank.canManage && !bank.archived) ?? []} bankId={banks.data?.items.find(bank => bank.id === bankId && bank.canManage && !bank.archived)?.id ?? ""} base={base} close={() => setEditing(null)} saved={() => { setEditing(null); refresh(); }} />}
  </div>;
}

type PracticeProblemProps = { path: string; jobPath: (id: string) => string; onBack: () => void; backLabel?: string; navigation?: PracticeNavigation; expectedVersionId?: string };
export function PracticeProblem({path,jobPath,onBack,backLabel,navigation,expectedVersionId}:PracticeProblemProps){
 const query = new URLSearchParams({ view: "practice", ...(expectedVersionId && { versionId: expectedVersionId }) });
 const data=useData<Problem>(`${path}?${query}`),auth=useData<{user:CampusUser}>("auth/me");return <>{(!data.data?.definition||!auth.data?.user)&&<PracticeToolbar title={data.data?.title??""} onBack={onBack} backLabel={backLabel} navigation={navigation}/>}<State data={data}><State data={auth}>{data.data?.definition&&auth.data?.user&&<PracticeEditor key={`${path}:${data.data.versionId}:${data.data.activity?.revision ?? ""}`} problem={data.data} userId={auth.data.user.id} path={path} jobPath={jobPath} onBack={onBack} backLabel={backLabel} navigation={navigation} expectedVersionId={expectedVersionId}/>}</State></State></>;
}
function PracticeEditor({problem,userId,path,jobPath,onBack,backLabel,navigation,expectedVersionId}:PracticeProblemProps&{problem:Problem;userId:string}){
 const {locale,t}=useLocale(),tx=(zh:string,en:string)=>locale==="zh"?zh:en,workspace=useWorkspaceSettings(userId),action=useMutation(),def=problem.definition!;
 const activity=problem.activity;
 const preview=problem.activity?.preview===true;
 const key=preview
   ? `codemaster:assignment-preview:${userId}:${problem.schoolId}:${problem.activity?.id}:${problem.activity?.revision}:${problem.id}:${problem.versionId}`
   : `codemaster:school-practice:${userId}:${problem.schoolId}:${problem.id}:${problem.versionId}`;
 const [code,setCode]=useState(def.starterCode),[loaded,setLoaded]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[job,setJob]=useState<Job|null>(null),[jobId,setJobId]=useState<string|null>(null),[custom,setCustom]=useState(""),[pollError,setPollError]=useState("");
 const search=useSearchParams(),courseId=search.get("courseId"),chapterId=search.get("chapterId");
 const canReadTutorial=!preview&&(problem.activity?.kind!=="timed"||Boolean(problem.activity.resultsPublishedAt));
 const tutorialEndpoint=canReadTutorial&&problem.versionId?`schools/${encodeURIComponent(problem.schoolId)}/problems/${encodeURIComponent(problem.id)}/tutorial?${new URLSearchParams({
   versionId:problem.versionId,...(courseId&&chapterId?{courseId,chapterId}:{}),
 })}`:"";
 const tutorial = useProblemTutorial(tutorialEndpoint);
 const statementScrollRef = useRef<HTMLDivElement>(null);
 const customDetailsRef = useRef<HTMLDetailsElement>(null);
 const customInputRef = useRef<HTMLTextAreaElement>(null);
 function useCaseAsInput(input: string) {
   setCustom(input);
   if (customDetailsRef.current) customDetailsRef.current.open = true;
   requestAnimationFrame(() => customInputRef.current?.focus());
 }
 const jobEndpoint=jobId?jobPath(jobId):"";
 useEffect(()=>{if(!preview&&!problem.staffPractice&&job?.kind==="submit"&&!["queued","leased"].includes(job.state))window.dispatchEvent(new Event("codemaster:school-scholarship-changed"));},[job?.id,job?.kind,job?.state,preview,problem.staffPractice]);
 const [leftTab, setLeftTab] = useState<"problem" | "translation" | "tutorial" | "solution" | "submissions">("problem");
 const activeTab = leftTab === "tutorial" && !tutorial ? "problem" : leftTab;
 function selectTab(tab: typeof leftTab) {
   if (tab === "tutorial" && statementScrollRef.current) statementScrollRef.current.scrollTop = 0;
   setLeftTab(tab);
 }
 const submissions=useProblemSubmissions(`${path}/submissions`,`${jobId??""}:${job?.state??""}:${job?.status??""}`);
 useEffect(()=>{try{setCode(localStorage.getItem(key)??def.starterCode);}catch{}setLoaded(true);},[key,def.starterCode]);
 useEffect(()=>{if(loaded)try{localStorage.setItem(key,code);}catch{}},[key,code,loaded]);
 useEffect(()=>{if(!jobEndpoint)return;let stopped=false,timer:ReturnType<typeof setTimeout>;const poll=()=>productionApi<Job>(jobEndpoint).then(value=>{if(stopped)return;setJob(value);setPollError("");if(["queued","leased"].includes(value.state))timer=setTimeout(()=>void poll(),1000);}).catch(error=>{if(!stopped){setPollError(apiMessage(error));timer=setTimeout(()=>void poll(),3000);}});void poll();return()=>{stopped=true;clearTimeout(timer);};},[jobEndpoint]);
 const [clock,setClock]=useState(()=>Date.now());
 const deadline=activity?.kind==="timed"?activity.attempt?.deadlineAt:null;
 useEffect(()=>{if(!deadline)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[deadline]);
 const remaining=deadline?Math.max(0,Math.ceil((Date.parse(deadline)-clock)/1000)):null;
 const closed=problem.activity?.canSubmit===false||problem.activity?.kind==="timed"&&(!!problem.activity.attempt?.finishedAt||remaining===0||!!problem.activity.resultsPublishedAt);
 const hasAssistance = !preview && !problem.staffPractice && !path.startsWith("practice/");
 const tabItems = [
   { id: "problem", label: tx("题目描述", "Problem"), icon: BookOpen },
   ...(tutorial ? [{ id: "tutorial", label: tx("教程", "Tutorial"), icon: BookOpen }] as const : []),
   ...(hasAssistance ? [{ id: "translation", label: tx("中文题面", "Translation"), icon: Languages }] as const : []),
   ...(hasAssistance ? [{ id: "solution", label: tx("参考答案", "Solution"), icon: Lightbulb }] as const : []),
   { id: "submissions", label: tx("提交记录", "Submissions"), icon: History },
 ] as const;
 const pending=action.busy||!!jobId&&(!job||["queued","leased"].includes(job.state));
 const run=(kind:"samples"|"custom"|"submit")=>void action.run(async()=>{const next=await productionApi<{id:string}>(`${path}/submissions`,{method:"POST",body:{kind,code,language:"python",input:custom,requestId:crypto.randomUUID(),...(preview ? {versionId:problem.versionId,expectedRevision:problem.activity?.revision} : expectedVersionId&&{versionId:expectedVersionId})}});setJob(null);setJobId(next.id);});
 return <div className="space-y-3">
  <PracticeToolbar title={problem.title} onBack={onBack} backLabel={backLabel} navigation={navigation}/>
  {problem.staffPractice&&<p className="text-sm text-muted-foreground">{tx("教师练习 · 结果仅供个人查看，不计入学生成绩、奖学金或排名。","Teacher practice · Results are personal and do not count toward student grades, scholarship or rankings.")}</p>}
  {activity&&<div className="flex flex-wrap items-start justify-between gap-2 text-sm">
    <div className="min-w-0">
      <span className="font-medium">{activity.title}</span>
      {activity.kind==="assignment"&&activity.canSubmit&&activity.endsAt&&!preview&&
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("截止后仍可提交并查看判题结果。补交不计入作业成绩，也不发放作业完成奖学金等作业奖励。")}</p>}
    </div>
    <div className="flex items-center gap-3">
      {!preview&&<SchoolActivityScholarshipRule schoolId={problem.schoolId} activityId={activity.id}/>}
      {remaining!==null&&<span className={`font-mono tabular-nums ${remaining<300?"text-destructive":"text-muted-foreground"}`} role="timer" aria-label={tx("剩余时间","Time remaining")}>{closed?tx("已结束","Ended"):`${Math.floor(remaining/3600).toString().padStart(2,"0")}:${Math.floor(remaining%3600/60).toString().padStart(2,"0")}:${(remaining%60).toString().padStart(2,"0")}`}</span>}
    </div>
  </div>}
  <div className="grid min-w-0 gap-3 xl:grid-cols-2"><section className="min-w-0 rounded-lg border border-border bg-surface">
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2" role="tablist" aria-label={tx("题目内容", "Problem content")}>
      {tabItems.map(({ id, label, icon: Icon }, index) => (
        <button type="button" key={id} id={`school-practice-tab-${id}`} role="tab"
          aria-selected={activeTab === id} aria-controls={`school-practice-${id}`} tabIndex={activeTab === id ? 0 : -1}
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const offset = event.key === "ArrowRight" ? 1 : -1;
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabItems.length - 1
              : (index + offset + tabItems.length) % tabItems.length;
            const nextTab = tabItems[nextIndex].id;
            selectTab(nextTab);
            document.getElementById(`school-practice-tab-${nextTab}`)?.focus();
          }}
          onClick={() => selectTab(id)}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${activeTab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
          <Icon size={15} aria-hidden="true" />{label}
        </button>
      ))}
    </div>
    <div ref={statementScrollRef} className="max-h-[72vh] overflow-auto p-5">
      <div hidden={activeTab !== "problem"} id="school-practice-problem" role="tabpanel" aria-labelledby="school-practice-tab-problem">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold">{problem.title}</h1>
          <SolvedStatus solved={submissions.data?.solved ?? problem.solved ?? false} />
        </div>
        <MathContent content={def.statement} />
        <div className="mt-5 space-y-4">
          {def.samples.map((sample, index) => (
            <div key={index}>
              <h2 className="mb-2 font-semibold">{tx("样例", "Example")} {index + 1}</h2>
              <div className="grid gap-2">
                <div>
                  <span className="text-xs text-muted-foreground">{tx("输入", "Input")}</span>
                  <pre className="overflow-auto rounded bg-surface-subtle p-3 text-sm">{sample.input}</pre>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{tx("预期输出", "Expected")}</span>
                  <pre className="overflow-auto rounded bg-surface-subtle p-3 text-sm">{sample.expected}</pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {(activeTab === "translation" || activeTab === "solution") && (
        <div id={`school-practice-${activeTab}`} role="tabpanel" aria-labelledby={`school-practice-tab-${activeTab}`}>
          <SchoolAssistance key={`${problem.versionId}:${activeTab}`} schoolId={problem.schoolId}
            target={{ type: "problem", problemId: problem.id, versionId: problem.versionId!, activityId: problem.activity?.id }}
            kind={activeTab === "translation" ? "FULL_TRANSLATION" : "FULL_SOLUTION"} />
        </div>
      )}
      {tutorial && (
        <div hidden={activeTab !== "tutorial"} id="school-practice-tutorial" role="tabpanel"
          aria-labelledby="school-practice-tab-tutorial" tabIndex={0}>
          {activeTab === "tutorial" && <ProblemTutorial tutorial={tutorial} />}
        </div>
      )}
      <div hidden={activeTab !== "submissions"} id="school-practice-submissions" role="tabpanel" aria-labelledby="school-practice-tab-submissions">
        <ProblemSubmissionsTable feed={submissions} />
      </div>
    </div>
  </section>
  <div className="min-w-0 space-y-3"><section className="overflow-hidden rounded-lg border border-border bg-surface"><div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm"><strong>Python 3</strong><div className="flex items-center gap-1"><CopyCodeButton code={code}/><Button size="sm" variant="ghost" aria-label={tx("编辑器设置","Editor settings")} onClick={()=>setSettingsOpen(true)}><Settings size={16}/></Button></div></div><div className="h-[370px]"><CodeEditor idPrefix="school-practice" code={code} onChange={setCode} language="python" settings={workspace.settings} status={loaded?tx("草稿已保存（本地）","Draft saved locally"):""} onEnableVim={()=>workspace.update({keyBinding:"vim"})}/></div><div className="flex justify-end gap-2 border-t border-border p-2"><Button size="sm" variant="secondary" disabled={!loaded||pending||closed} onClick={()=>run("samples")}>{tx("运行样例","Run")}</Button><Button size="sm" disabled={!loaded||pending||closed} onClick={()=>run("submit")}>{tx("提交","Submit")}</Button></div></section><details ref={customDetailsRef} className="rounded-lg border border-border bg-surface p-3 text-sm"><summary className="cursor-pointer">{tx("自定义输入","Custom input")}</summary><textarea ref={customInputRef} aria-label={tx("自定义输入","Custom input")} className={`${textarea} mt-2 font-mono`} rows={3} value={custom} onChange={e=>setCustom(e.target.value)}/><Button size="sm" variant="secondary" disabled={pending||!loaded||closed} onClick={()=>run("custom")}>{tx("运行输入","Run input")}</Button></details><div className="overflow-hidden rounded-lg border border-border bg-surface"><RunResultPanel result={job&&job.kind!==("validation" as string)?{...job,testResults:job.caseFeedback}:null} error={action.error||pollError} reload={()=>{if(jobEndpoint)void action.run(async()=>setJob(await productionApi<Job>(jobEndpoint)));}} loading={pending} currentCode={code} currentLanguage="python" onUseCase={pending || closed ? undefined : useCaseAsInput}/></div></div></div><WorkspaceSettingsDialog editorOnly initialSection="editor" open={settingsOpen} onOpenChange={setSettingsOpen} settings={workspace.settings} update={workspace.update} reset={workspace.reset}/></div>;
}

export function PublicPractice(props:{problemId?:string}={}){return <PublicPracticeContents key={props.problemId??"list"} {...props}/>;}
function PublicPracticeContents({ problemId }: { problemId?: string }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const search = useSearchParams();
  const selected = search.get("problemId") ?? problemId ?? null;
  const urlQuery = (search.get("publicProblemQuery") ?? "").slice(0, 100);
  const rawPage = Number(search.get("publicProblemPage") ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000 ? rawPage : 1;
  const [draft, setDraft] = useState<string | null>(null);
  const [observedQuery, setObservedQuery] = useState(urlQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  // The input responds synchronously to typing. App Router's URL snapshot
  // acknowledges edits later, and an older acknowledgment cannot replace a draft.
  if (observedQuery !== urlQuery) {
    setObservedQuery(urlQuery);
    if (draft === urlQuery) setDraft(null);
  }
  const query = draft ?? urlQuery;
  useEffect(() => {
    const restore = () => {
      clearTimeout(timer.current);
      composing.current = false;
      setDraft(null);
    };
    window.addEventListener("popstate", restore);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("popstate", restore);
    };
  }, []);
  function changeQuery(value: string) {
    const source = window.location.href;
    const currentQuery = new URLSearchParams(window.location.search).get("publicProblemQuery") ?? "";
    setDraft(value === currentQuery && value === urlQuery ? null : value);
    clearTimeout(timer.current);
    if (composing.current || currentQuery === value) return;
    timer.current = setTimeout(() => {
      if (window.location.href !== source) {
        setDraft(null);
        return;
      }
      updatePracticeLocation({ publicProblemQuery: value, publicProblemPage: null }, true);
    }, 180);
  }

  const list = useData<{ items: Problem[]; page: number; query: string; hasMore: boolean }>(
    `practice/problems?${new URLSearchParams({ q: urlQuery.trim(), page: String(page) })}`,
  );
  const matchesFilters = list.data?.query === query.trim() && list.data?.page === page;
  const rows = matchesFilters ? list.data?.items ?? [] : [];
  const pending = !list.error && (list.loading || !matchesFilters);
  const selectProblem = (id: string | null) => updatePracticeLocation({ problemId: id });
  const changePage = (next: number) => updatePracticeLocation({ publicProblemPage: next === 1 ? null : String(next) });
  if (selected) return <PublicProblemWorkspace key={`${selected}:${search.get("versionId") ?? ""}`} id={selected} catalog={{ ...list, data: pending ? null : { items: rows }, loading: pending }} />;

  return <div className={problemStyles.page}>
    <div className={`${problemStyles.toolbar} flex-wrap`}>
      <ProblemCatalogSearch value={query} maxLength={100} label={tx("搜索编号、标题或题库", "Search ID, title, or bank")}
        onChange={changeQuery}
        onCompositionStart={() => { composing.current = true; clearTimeout(timer.current); }}
        onCompositionEnd={value => { composing.current = false; changeQuery(value); }} />
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={list.reload} aria-label={tx("刷新题目", "Refresh problems")}>
        <RefreshCw size={15} aria-hidden="true"/>
      </Button>
    </div>
    <State data={{ ...list, loading: pending, data: pending ? null : list.data }}>
      <LearnerProblemTable rows={rows} onOpen={selectProblem} empty={query.trim()
        ? tx("没有匹配的题目，请尝试其他搜索。", "No matching problems. Try another search.")
        : tx("暂时没有可显示的公开题目。", "There are no public problems to show.")} />
      {(page > 1 || list.data?.hasMore) && <nav className="flex flex-wrap items-center justify-end gap-2" aria-label={tx("题目分页", "Problem pages")}>
        <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => changePage(page - 1)}>{tx("上一页", "Previous")}</Button>
        <span className={problemStyles.count}>{tx(`第 ${page} 页`, `Page ${page}`)}</span>
        <Button size="sm" variant="secondary" disabled={!list.data?.hasMore || page >= 100000} onClick={() => changePage(page + 1)}>{tx("下一页", "Next")}</Button>
      </nav>}
    </State>
  </div>;
}

export function SchoolJudgeStatus({schoolId}:{schoolId:string}){
 const {locale}=useLocale(),tx=(zh:string,en:string)=>locale==="zh"?zh:en,data=useData<{ready:boolean;queued:number;running:number;failed:number;completed:number}>(`schools/${schoolId}/judge-status`);
 return <State data={data}><div className="rounded-lg border border-border bg-surface p-4"><div className="flex items-center justify-between"><strong>{tx("判题服务","Judge service")}</strong><Button size="sm" variant="ghost" onClick={data.reload}><RefreshCw size={15}/>{tx("刷新","Refresh")}</Button></div><p className={`mt-2 text-sm ${data.data?.ready?"text-success":"text-muted-foreground"}`}>{data.data?.ready?tx("隔离执行器已就绪","Isolated executor is ready"):tx("执行器暂不可用，任务将排队等待","Executor unavailable. Requests remain queued.")}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{([['queued',tx("等待中","Queued")],['running',tx("运行中","Running")],['completed',tx("已完成","Completed")],['failed',tx("服务异常","Service failures")]] as const).map(([key,label])=><div key={key}><span className="text-muted-foreground">{label}</span><div className="text-xl font-semibold">{data.data?.[key]??0}</div></div>)}</div></div></State>;
}

export function PublicProblemReview() {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const data = useData<{ items: Problem[] }>("platform/problem-publications");
  const action = useMutation();
  const [preview, setPreview] = useState<Problem | null>(null);
  const status = (problem: Problem) => problem.platformPublished ? tx("已公开", "Public")
    : problem.publicRequestStatus === "pending" ? tx("待审核", "Pending review")
      : problem.publicRequestStatus === "rejected" ? tx("已驳回", "Rejected")
        : tx("未公开", "Not public");
  const rows = [...(data.data?.items ?? [])].sort((a, b) =>
    Number(b.publicRequestStatus === "pending") - Number(a.publicRequestStatus === "pending"));
  async function decide(decision: "approve" | "reject" | "withdraw") {
    if (!preview) return;
    const suffix = decision === "approve" ? "" : `/${preview.id}/${decision}`;
    await productionApi(`platform/problem-publications${suffix}`, {
      method: "POST",
      body: { schoolId: preview.schoolId, problemId: preview.id, versionId: preview.versionId },
    });
    setPreview(null);
    data.reload();
  }
  return <div className="space-y-3">
    <Feedback action={action} />
    <State data={data}>
      <div className="overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-subtle"><tr>
            <th scope="col" className="px-4 py-2">{tx("题目", "Problem")}</th>
            <th scope="col" className="px-4 py-2">{tx("学校", "School")}</th>
            <th scope="col" className="px-4 py-2">{tx("状态", "Status")}</th>
            <th scope="col" className="px-4 py-2">{tx("操作", "Actions")}</th>
          </tr></thead>
          <tbody>{rows.map(problem => <tr key={`${problem.schoolId}:${problem.id}`} className="border-t border-border">
            <td className="px-4 py-2">{problem.title}</td>
            <td className="px-4 py-2">{problem.schoolName}</td>
            <td className="px-4 py-2">{status(problem)}</td>
            <td className="px-4 py-2"><Button size="sm" variant="secondary" disabled={action.busy} onClick={() => void action.run(async () => {
              setPreview(await productionApi<Problem>(`platform/problem-publications/${problem.id}?schoolId=${problem.schoolId}`));
            })}>{tx("预览与审核", "Preview & review")}</Button></td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm text-muted-foreground">{tx("暂无可审核的已发布题目。", "No published problems are available for review.")}</p>}
      </div>
    </State>
    <Dialog open={!!preview} onOpenChange={open => { if (!open && !action.busy) setPreview(null); }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
        <DialogTitle>{preview?.title}</DialogTitle>
        <DialogDescription>{tx("公开后，所有登录用户均可练习此版本。下方仅展示公开题干和样例。", "Publishing lets any signed-in user practice this version. The preview shows the statement and samples.")}</DialogDescription>
        {preview?.definition && <>
          <MathContent content={preview.definition.statement} />
          {preview.definition.samples.map((sample, index) => <pre key={index} className="overflow-auto rounded bg-surface-subtle p-3 text-sm">
            {tx("输入", "Input")}: {sample.input}{"\n"}{tx("预期输出", "Expected")}: {sample.expected}
          </pre>)}
        </>}
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          {preview?.publicRequestStatus === "pending" && !preview.platformPublished &&
            <Button variant="secondary" disabled={action.busy} onClick={() => void action.run(() => decide("reject"))}>{tx("驳回", "Reject")}</Button>}
          <Button disabled={action.busy} onClick={() => void action.run(() => decide(preview?.platformPublished ? "withdraw" : "approve"))}>
            {preview?.platformPublished ? tx("从公开区下架", "Withdraw public access") : tx("审核并公开", "Approve and publish")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
