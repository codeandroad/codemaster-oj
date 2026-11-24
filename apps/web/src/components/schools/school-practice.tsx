"use client";

import { SchoolGroupManager, type SchoolGroup } from "./school-group-manager";
import { SchoolImportHistory } from "./catalog-groups";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCatalogFilterUrl } from "@/components/use-catalog-filter-preferences";
import { RefreshCw } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import problemStyles from "@/components/student/problems-page.module.css";
import { ProblemCatalogSearch } from "@/components/student/problem-catalog-search";
import { StudentProblemFilter } from "@/components/student/problem-filter";
import { ProblemCatalogCourseFilter, problemCourseFilterKey, publicProblemCourseFilterKey, type ProblemCatalogResult } from "@/components/student/problem-catalog-course-filter";
import { adjacentProblemRows, type ProblemEditorTab } from "@/components/teacher/problem-editor-navigation";
import { Feedback, State, input, useData, useMutation } from "@/components/student/shared";
import { LearnerProblemTable, SchoolPracticeCatalog } from "./school-practice-catalog";
import type { Bank, Problem } from "./school-practice-types";
import { PlatformProblemEditor } from "./platform-problems";
import type { PlatformSourceProblem } from "@/components/teacher/platform-problem-source";
import { SchoolProblemEditor } from "./school-problem-editor";
import { practiceCatalogFilters, practiceFilterKeys, practiceLocation, practiceNavigationItems, practiceProblemMatches, schoolCatalogProblemLocation, type PracticeCatalogFilters } from "./school-practice-navigation";
import { PublicProblemWorkspace } from "./public-problem-workspace";
import { PracticeProblem } from "./school-problem-workspace";

function updatePracticeLocation(patch: Record<string, string | null>) {
  const current = window.location;
  const href = practiceLocation(current.pathname, current.search, patch, current.hash);
  if (href === `${current.pathname}${current.search}${current.hash}`) return;
  window.history.pushState(null, "", href);
}

const schoolCatalogKeys = [...Object.values(practiceFilterKeys), problemCourseFilterKey];

export function SchoolPractice(props: { accountId: string; schoolId: string; role: string; initialProblemId?: string }) {
  return <SchoolPracticeContents key={`${props.schoolId}:${props.role}:${props.initialProblemId ?? "list"}`} {...props} />;
}

function SchoolPracticeContents({ accountId, schoolId, role, initialProblemId }: { accountId: string; schoolId: string; role: string; initialProblemId?: string }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const base = `schools/${schoolId}`;
  const params = useSearchParams();
  const pathname = usePathname();
  const selected = params.get("problemId") ?? initialProblemId ?? null;
  const { search, changeUrlFilters, ready } = useCatalogFilterUrl(
    `campus-judge:school-problems:v1:${accountId}:${schoolId}:${role}`, schoolCatalogKeys,
    !selected || !params.has("courseId"),
  );
  const staff = role === "teacher" || role === "school_admin";
  const filters = practiceCatalogFilters(search, staff);

  const courseId = staff ? "" : search.get(problemCourseFilterKey)?.toLowerCase() ?? "";
  const banks = useData<{ items: Bank[] }>(`${base}/problem-banks`);
  const { bankId } = filters;
  const groups = useData<{items: SchoolGroup[]}>(staff ? base + "/problem-groups" : "");
  const bankGroups = (groups.data?.items ?? []).filter(group => group.bankId === bankId);
  const [groupBank,setGroupBank] = useState<Bank | null>(null);
  const catalogQuery = new URLSearchParams(staff ? {view:"management"} : { includeCourseFilters: "1", ...(courseId && { courseId }) });
  const allProblems = useData<ProblemCatalogResult<Problem>>(ready ? `${base}/problems${catalogQuery.size ? `?${catalogQuery}` : ""}` : "");
  const bankQuery = new URLSearchParams(catalogQuery);
  if (bankId) bankQuery.set("bankId", bankId);
  const bankProblems = useData<ProblemCatalogResult<Problem>>(ready && !staff && bankId && bankId !== "platform" ? `${base}/problems?${bankQuery}` : "");
  const problems = !staff && bankId && bankId !== "platform" ? bankProblems : allProblems;
  const platformSources = useData<{ items: PlatformSourceProblem[] }>(staff ? `platform/source-problems?schoolId=${schoolId}` : "");
  const sourceProblems: Problem[] = (platformSources.data?.items ?? []).map(problem => ({
    id: problem.id, title: problem.title, schoolId, bankId: "platform", bankName: "CodeMaster",
    ownerScope: "platform", revision: 1, versionId: problem.versionId ?? null, published: problem.published,
    canManage: problem.canEdit === true, validation: { id: problem.versionId ?? problem.id, state: ["Waiting", "Judging"].includes(problem.validationStatus ?? "") ? "queued" : "done", status: problem.validationStatus && !["Draft", "Incomplete", "Waiting", "Judging"].includes(problem.validationStatus) ? problem.validationStatus : null },
  }));
  const withSources = (items: Problem[]) => {
    const merged = new Map(items.map(problem => [problem.id, problem]));
    for (const problem of sourceProblems) merged.set(problem.id, { ...merged.get(problem.id), ...problem });
    return [...merged.values()];
  };
  const catalogBanks = [...(banks.data?.items ?? []), ...(sourceProblems.length ? [{ id: "platform", name: "CodeMaster", revision: 1, archived: false, canManage: false }] : [])];
  const catalogMatches = staff || (problems.data?.courseId ?? "") === courseId;
  const catalog = { ...problems, loading: !problems.error && (!ready || problems.loading || !catalogMatches), data: catalogMatches ? problems.data : null };
  const inventory = staff ? withSources(catalog.data?.items ?? []) : catalog.data?.items ?? [];
  const groupedIds = new Set((filters.groupId === "ungrouped" ? bankGroups : bankGroups.filter(g => g.id === filters.groupId)).flatMap(g => g.problemIds));
  const catalogProblems = staff && bankId && bankId !== "platform" && filters.groupId
    ? inventory.filter(p => p.bankId === bankId && (filters.groupId === "ungrouped" ? !groupedIds.has(p.id) : groupedIds.has(p.id)))
    : inventory;
  const navigationProblems = (allProblems.data?.courseId ?? "") === courseId ? allProblems.data?.items ?? [] : [];
  const [bankEdit, setBankEdit] = useState<Bank | "new" | null>(null);
  const [archiveProblem,setArchiveProblem] = useState<Problem | null>(null);
  const [archiveBank, setArchiveBank] = useState<Bank | null>(null);
  const [bankName, setBankName] = useState("");
  const bankRequest = useRef("");
  const bankPending = useRef(false);
  const editBookmark = staff && params.get("problemEdit") === "1" ? selected : null;
  const sourceBookmark = !!editBookmark && (params.get("source") === "platform" || !params.has("source") && sourceProblems.some(p=>p.id===editBookmark));
  const closeBookmark = () => { updatePracticeLocation({problemId:null,problemEdit:null,source:null,tab:null}); refresh(); };
  const action = useMutation();
  function refresh() { groups.reload(); banks.reload(); allProblems.reload(); bankProblems.reload(); platformSources.reload(); }
  function problemLocation(id: string) {
    const row = navigationProblems.find(problem => problem.id === id) ?? catalogProblems.find(problem => problem.id === id);
    return schoolCatalogProblemLocation(id, row?.courseContext);
  }
  function selectProblem(problemId: string | null) { updatePracticeLocation(problemId ? problemLocation(problemId) : { problemId }); }
  function changeFilters(patch: Partial<PracticeCatalogFilters>) {
    if (patch.bankId !== undefined && patch.bankId !== bankId) patch = {...patch, groupId:""};
    const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [practiceFilterKeys[key as keyof PracticeCatalogFilters], typeof value === "boolean" ? value ? "1" : null : value]));
    changeUrlFilters(fields);
  }
  function editProblem(problem: Problem, tab?: ProblemEditorTab) {
    updatePracticeLocation({problemId:problem.id, problemEdit:"1", source:problem.ownerScope === "platform" ? "platform" : "school",tab:tab ?? null});
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

  if (editBookmark) {
    const rows = catalogProblems.filter(problem => problem.canManage && !problem.archived
      && (problem.id === editBookmark || practiceProblemMatches(problem, filters, staff)));
    const { previous, next } = adjacentProblemRows(rows, editBookmark);
    const target = (problem?: Problem) => problem && ({title:problem.title,select:(tab?: ProblemEditorTab)=>editProblem(problem,tab)});
    const navigation = {previous:target(previous), next:target(next)};
    if (sourceBookmark) return <PlatformProblemEditor id={editBookmark} navigation={navigation} onClose={closeBookmark}/>;
    if (editBookmark === "new" && !banks.data) return <State data={banks}>{null}</State>;
    if (editBookmark !== "new" && !params.has("source") && !platformSources.data) return <State data={platformSources}>{null}</State>;
    return <SchoolProblemEditor key={editBookmark} id={editBookmark} schoolId={schoolId} admin={role==="school_admin"} bankId={banks.data?.items.find(b=>b.id===bankId && b.canManage && !b.archived)?.id ?? banks.data?.items.find(b=>b.canManage && !b.archived)?.id}
      initialTab={params.get("tab")} navigation={navigation} close={closeBookmark}
      onCreated={(id,tab)=>window.history.replaceState(null,"",practiceLocation(pathname,params.toString(),{problemId:id,source:"school",tab:tab ?? null}))}/>;
  }
  if (!staff && selected && params.has("publicCourseId")) {
    return <PublicProblemWorkspace id={selected} workspaceSchoolId={schoolId} catalog={catalog}/>;
  }
  if (selected) return <PracticeProblem key={`${schoolId}:${selected}`} path={`${base}/problems/${encodeURIComponent(selected)}`} jobPath={id => `${base}/judge-jobs/${id}`} onBack={() => { selectProblem(null); refresh(); }} navigation={{ currentId: selected, items: practiceNavigationItems(staff ? catalogProblems : navigationProblems, filters, staff, selected, banks.data?.items.filter(bank => bank.archived).map(bank => bank.id)), onSelect: selectProblem, href: id => practiceLocation(pathname, params.toString(), problemLocation(id)) }} />;

  const catalogView = <SchoolPracticeCatalog
    banks={catalogBanks}
    problems={catalogProblems}
    learnerResource={staff ? undefined : catalog}
    courseFilter={staff ? undefined : {
      value: courseId, courses: allProblems.data?.courses,
      onChange: value => changeUrlFilters({ [problemCourseFilterKey]: value }),
    }}
    allProblems={staff ? withSources(allProblems.data?.items ?? []) : allProblems.data?.items ?? []}
    role={role}
    filters={filters}
    groups={groups.data?.items ?? []}
    onManageGroups={setGroupBank}
    onArchiveProblem={p => {action.reset(); setArchiveProblem(p);}}
    onFiltersChange={changeFilters}
    busy={action.busy}
    onRefresh={refresh}
    onEditBank={editBank}
    onArchiveBank={bank => { action.reset(); setArchiveBank(bank); }}
    onNewProblem={() => updatePracticeLocation({problemId:"new",problemEdit:"1",source:"school",tab:null})}
    onOpen={id => {
      const problem = catalogProblems.find(item => item.id === id);
      if (staff && problem?.canManage) editProblem(problem);
      else selectProblem(id);
    }}
    renderActions={problem => <>
      {problem.canManage && <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => editProblem(problem)}>{tx("编辑", "Edit")}</Button>}
      {problem.ownerScope !== "platform" && problem.canManageTutorial && <Button type="button" size="sm" variant="ghost"
        onClick={()=>editProblem(problem,"tutorial")}>{tx("编辑教程","Edit tutorial")}</Button>}
      {problem.ownerScope !== "platform" && problem.canManage && <>
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
      {problem.ownerScope !== "platform" && role === "school_admin" && problem.published && problem.versionId &&
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
      {problem.ownerScope !== "platform" && problem.published && !banks.data?.items.find(bank => bank.id === problem.bankId)?.archived && <Button size="sm" variant="ghost" onClick={() => selectProblem(problem.id)}>{tx("练习", "Practice")}</Button>}
    </>}
  />;
  return <div className="space-y-3">
    <Feedback action={action} />
    {staff && <SchoolImportHistory schoolId={schoolId}/>}
    {staff && groups.error && <State data={groups}>{null}</State>}
    {groupBank && <SchoolGroupManager base={base} bank={groupBank} onClose={() => setGroupBank(null)}
      onChanged={removed => {groups.reload(); if (removed && removed === filters.groupId) changeFilters({groupId:""});}}/>}
    {staff && <State data={platformSources}>{null}</State>}
    <State data={banks}>{staff ? <State data={problems}>{catalogView}</State> : catalogView}</State>
    {archiveProblem && <Dialog open onOpenChange={open => {if (!open && !action.busy) setArchiveProblem(null);}}><DialogContent>
      <DialogTitle>{archiveProblem.archived ? tx("恢复题目","Restore problem") : tx("归档题目","Archive problem")}</DialogTitle>
      <DialogDescription>{archiveProblem.title} · {archiveProblem.archived ? tx("恢复后可编辑并重新提交审核。","Restore editing and submit for review again.") : tx("归档将停止新的自由练习，保留作业、题目版本和提交记录。","Archiving stops new free practice and preserves assignments, versions and submissions.")}</DialogDescription>
      <Feedback action={action}/><div className="flex justify-end gap-2"><Button variant="secondary" disabled={action.busy} onClick={() => setArchiveProblem(null)}>{tx("取消","Cancel")}</Button>
      <Button disabled={action.busy} onClick={() => void action.run(async () => {
        await productionApi(`${base}/problems/${archiveProblem.id}/${archiveProblem.archived ? "restore" : "archive"}`,{method:"POST",body:{expectedRevision:archiveProblem.revision}});
        setArchiveProblem(null); refresh();
      })}>{tx("确认","Confirm")}</Button></div></DialogContent></Dialog>}
    <Dialog open={!!archiveBank} onOpenChange={open => { if (!open && !bankPending.current) setArchiveBank(null); }}>
      {archiveBank && <DialogContent>
        <DialogTitle>{archiveBank.archived ? tx("恢复题库", "Restore bank") : tx("归档题库", "Archive bank")}</DialogTitle>
        <DialogDescription>{archiveBank.archived
          ? tx(`恢复「${archiveBank.name}」后，已发布题目会重新出现在本校题库。`, `Published problems in “${archiveBank.name}” will appear in the school catalog again.`)
          : tx(`归档「${archiveBank.name}」后，学生将无法从本校题库打开其中的题目。已有提交会保留。`, `Students will no longer be able to open problems in “${archiveBank.name}” from the school catalog. Existing submissions are retained.`)}</DialogDescription>
        <Feedback action={action}/>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={action.busy} onClick={() => setArchiveBank(null)}>{tx("取消", "Cancel")}</Button>
          <Button disabled={action.busy} onClick={() => {
            if (bankPending.current) return;
            bankPending.current = true;
            void action.run(async () => {
              await productionApi(`${base}/problem-banks/${archiveBank.id}`, { method: "PATCH", body: { expectedRevision: archiveBank.revision, archived: !archiveBank.archived } });
              setArchiveBank(null);
              refresh();
            }).finally(() => { bankPending.current = false; });
          }}>{archiveBank.archived ? tx("恢复", "Restore") : tx("归档", "Archive")}</Button>
        </div>
      </DialogContent>}
    </Dialog>
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
  </div>;
}

export { PracticeProblem } from "./school-problem-workspace";

const publicFilterKeys = {
  topic: "publicProblemTopic", status: "publicProblemStatus", mode: "publicProblemMode", savedOnly: "publicProblemSavedOnly",
};
const publicCatalogKeys = ["publicProblemQuery", publicProblemCourseFilterKey, "publicProblemPage", "publicProblemsFromCourse", ...Object.values(publicFilterKeys)];
type PublicProblemCatalog = ProblemCatalogResult<Problem> & {
  fromCourse?: boolean;
  page: number; query: string; hasMore: boolean; topics: string[];
  filters: { topic: string; status: string; mode: string; savedOnly: boolean };
};

type PublicPracticeProps = { accountId: string; problemId?: string; workspaceSchoolId?: string | null };

export function PublicPractice(props: PublicPracticeProps) {
  return <PublicPracticeContents key={props.problemId ?? "list"} {...props} />;
}
function PublicPracticeContents({ accountId, problemId, workspaceSchoolId }: PublicPracticeProps) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const params = useSearchParams();
  const { search, changeUrlFilters, rememberUrlFilters, ready } = useCatalogFilterUrl(
    `campus-judge:public-problems:v1:${accountId}`, publicCatalogKeys,
    !(params.get("problemId") ?? problemId) || !params.has("publicCourseId"),
  );
  const selected = search.get("problemId") ?? problemId ?? null;
  const urlQuery = (search.get("publicProblemQuery") ?? "").slice(0, 100);
  const courseId = search.get(publicProblemCourseFilterKey)?.toLowerCase() ?? "";
  const fromCourse = search.get("publicProblemsFromCourse") === "1";
  const topic = (search.get(publicFilterKeys.topic) ?? "").trim();
  const status = search.get(publicFilterKeys.status) ?? "";
  const mode = search.get(publicFilterKeys.mode) ?? "";
  const savedOnly = search.get(publicFilterKeys.savedOnly) === "1";
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
    if (currentQuery !== value) rememberUrlFilters({ publicProblemQuery: value, publicProblemPage: null });
    else rememberUrlFilters({});
    if (composing.current || currentQuery === value) return;
    timer.current = setTimeout(() => {
      if (window.location.href !== source) {
        setDraft(null);
        return;
      }
      changeUrlFilters({ publicProblemQuery: value, publicProblemPage: null });
    }, 180);
  }

  const list = useData<PublicProblemCatalog>(
    ready ? `practice/problems?${new URLSearchParams({
      q: urlQuery.trim(), page: String(page), includeCourseFilters: "1", ...(courseId && { courseId }),
      ...(fromCourse && { fromCourse: "1" }),
      ...(topic && { topic }), ...(status && { status }), ...(mode && { mode }), ...(savedOnly && { savedOnly: "1" }),
    })}` : "",
  );
  const matchesFilters = list.data?.query === query.trim() && list.data?.page === page && (list.data?.courseId ?? "") === courseId
    && Boolean(list.data?.fromCourse) === fromCourse
    && list.data?.filters?.topic === topic && list.data?.filters?.status === status
    && list.data?.filters?.mode === mode && list.data?.filters?.savedOnly === savedOnly;
  const rows = matchesFilters ? list.data?.items ?? [] : [];
  const pending = !list.error && (!ready || list.loading || !matchesFilters);
  const selectProblem = (id: string | null) => {
    const course = rows.find(row => row.id === id)?.courseContext;
    changeUrlFilters({
      problemId: id, publicProblemQuery: query, publicCourseId: course?.courseId ?? null,
      publicChapterId: course?.chapterId ?? null, fromProblemCatalog: id ? "1" : null,
    }, true);
  };
  function changeCourse(value: string) {
    clearTimeout(timer.current);
    changeUrlFilters({ [publicProblemCourseFilterKey]: value, publicProblemQuery: query, publicProblemPage: null });
  }
  function changeFilter(key: keyof typeof publicFilterKeys, value: string) {
    clearTimeout(timer.current);
    changeUrlFilters({ [publicFilterKeys[key]]: value, publicProblemQuery: query, publicProblemPage: null });
  }
  const changePage = (next: number) => changeUrlFilters({ publicProblemPage: next === 1 ? null : String(next) }, true);
  if (selected) return <PublicProblemWorkspace key={`${selected}:${search.get("versionId") ?? ""}`} id={selected} workspaceSchoolId={workspaceSchoolId} catalog={{ ...list, data: pending ? null : { items: rows }, loading: pending }} />;

  return <div className={problemStyles.page}>
    <div className={`${problemStyles.toolbar} flex-wrap`}>
      <ProblemCatalogSearch value={query} maxLength={100} label={tx("搜索编号、标题、题库或主题", "Search ID, title, bank, or topic")}
        onChange={changeQuery}
        onCompositionStart={() => { composing.current = true; clearTimeout(timer.current); }}
        onCompositionEnd={value => { composing.current = false; changeQuery(value); }} />
      <ProblemCatalogCourseFilter courses={list.data?.courses} value={courseId} onChange={changeCourse}/>
      <label className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap text-sm">
        <input type="checkbox" className="accent-primary" checked={fromCourse} onChange={event => {
          clearTimeout(timer.current);
          changeUrlFilters({ publicProblemsFromCourse: event.currentTarget.checked ? "1" : null, publicProblemQuery: query, publicProblemPage: null });
        }}/>
        {tx("来自我的课程", "From my courses")}
      </label>
      <StudentProblemFilter topics={list.data?.topics ?? []} topic={topic} status={status} mode={mode} savedOnly={savedOnly}
        onTopic={value => changeFilter("topic", value)} onStatus={value => changeFilter("status", value)}
        onMode={value => changeFilter("mode", value)} onSaved={value => changeFilter("savedOnly", value ? "1" : "")}/>
    </div>
    <State data={{ ...list, loading: pending, data: pending ? null : list.data }}>
      <LearnerProblemTable rows={rows} onOpen={selectProblem} empty={query.trim() || courseId || fromCourse || topic || status || mode || savedOnly
        ? tx("没有匹配的题目，请调整搜索或筛选条件。", "No matching problems. Try another search or filter.")
        : tx("暂时没有可练习的平台题目。", "There are no platform problems available to practice.")} />
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

export { PublicProblemReview } from "./platform-problem-library";
