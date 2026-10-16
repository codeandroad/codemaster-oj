"use client";

import { AppLink as Link } from "@/components/navigation";
import { chapterDirectoryTitle } from "@/lib/learning-chapter-title";
import {LessonContent} from "../student/shared";
import {LearningCover,courseCovers,courseDifficulties} from "@/components/learning-course";
import {PythonPracticePanel,type CoursePractice} from "./python-practice-panel";
import {canUseLegacyPythonPractice} from "./legacy-python-practice";
import {LearningProgressDialog} from "./learning-progress";
import {LearningImport} from "./learning-import";
import {downloadLearningMarkdown,type LearningDocument} from "./learning-document";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import { ArrowDown, ArrowUp, Eye, FilePlus2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { productionApi, type ProductionProblem } from "@/lib/production-api";
import { ProblemPicker } from "./problem-banks";
import {
  area,
  Empty,
  Feedback,
  Field,
  input,
  link,
  Modal,
  move,
  panel,
  State,
  Table,
  Tabs,
  useAction,
  useData,
  useDirty,
} from "./shared";

interface ChapterProblem {
  problemId: string;
  title: string;
  versionId: string;
  bankName?: string;
  published?: boolean;
  schoolVisibleAt?: string | null;
  rankReviewStatus?: ProductionProblem["rankReviewStatus"];
  readyForCourse?: boolean;
}
interface CoursePublishCandidate {
  problemId: string;
  versionId: string;
  title: string;
  bankName?: string;
  rankReviewStatus?: ChapterProblem["rankReviewStatus"];
  status: "ready" | "published" | "version-changed" | "not-validated" | "no-access" | "conflicting-links";
}
function courseProblemReady(problem: ChapterProblem): boolean {
  return problem.readyForCourse ?? Boolean(
    problem.published && problem.schoolVisibleAt && problem.rankReviewStatus === "approved",
  );
}
function mergeReviewStatus(local: Chapter[], previous: Chapter[], fresh: Chapter[]): Chapter[] {
  if (JSON.stringify(local) === JSON.stringify(previous)) return fresh;
  const status = new Map(fresh.flatMap((chapter) => chapter.problems)
    .map((problem) => [`${problem.problemId}:${problem.versionId}`, problem]));
  return local.map((chapter) => ({ ...chapter, problems: chapter.problems.map((problem) => {
    const updated = status.get(`${problem.problemId}:${problem.versionId}`);
    return updated ? { ...problem, bankName: updated.bankName, published: updated.published,
      schoolVisibleAt: updated.schoolVisibleAt, rankReviewStatus: updated.rankReviewStatus,
      readyForCourse: updated.readyForCourse } : problem;
  }) }));
}
interface Chapter {
  id: string;
  title: string;
  content: string;
  position: number;
  objective?: string;
  checkpoint?: string;
  checkpointAnswer?: string;
  problems: ChapterProblem[];
}
interface Path {
  id: string;
  archived?:boolean;
  title: string;
  description: string;
  category: string;
  published: boolean;
  chapterCount: number;
  estimatedMinutes?: number;
  canEdit: boolean;
  difficulty?:keyof typeof courseDifficulties;
  coverKey?:keyof typeof courseCovers;
  practiceBundle?:CoursePractice[];
  chapters?: Chapter[];
}
interface Resource {
  id: string;
  type: string;
  title: string;
  content: string;
  pathId?: string | null;
  chapterId?: string | null;
  scope: string;
  canEdit?: boolean;
}
export function TeacherLearning() {
  const {t,locale} = useLocale();
  const tx=(zh:string,en:string)=>locale==="en"?en:zh;
  const [showArchived,setShowArchived]=useState(false);
  const [archiveTarget,setArchiveTarget]=useState<Path|null>(null);
  const router = useRouter(),
    paths = useData<{ items: Path[] }>(showArchived?"learning-paths?archived=true":"learning-paths"),
    resources = useData<{ items: Resource[] }>("learning-resources"),
    [tab, setTab] = useState("课程"),
    [create, setCreate] = useState(false),
    [importing,setImporting]=useState(false),
    [editing, setEditing] = useState<Resource | null>(null),
    action = useAction();
  return (
    <>
      <PageHeader
        eyebrow={t("课程")}
        title={t("课程")}
        description={t("课程组织章节、讲解与练习；班级维护学生名单，作业和限时训练另行发布。")}
        action={
          <div className="flex flex-wrap gap-2">{tab==="课程"&&<Button variant="secondary" onClick={()=>setImporting(true)}>{t("导入课程 Markdown")}</Button>}
          <Button onClick={() => setCreate(true)}>
            {tab === "课程" ? <Plus size={15} /> : <FilePlus2 size={15} />}{" "}
            {tab === "课程" ? t("新建课程") : t("添加资料")}
          </Button></div>
        }
      />
      {importing&&<LearningImport onClose={()=>setImporting(false)} onImported={id=>{setImporting(false);router.push(`/teacher/courses/${id}`);}}/>}
      <Tabs items={[t("课程"), t("学习资料")]} value={t(tab)} onChange={label=>{const next=label===t("课程")?"课程":"学习资料";setTab(next);if(next!=="课程")setShowArchived(false);}} />
      <Feedback action={action} />
      {tab==="课程"&&<div className="mt-4 flex gap-2"><Button variant={showArchived?"secondary":"default"} aria-pressed={!showArchived} onClick={()=>setShowArchived(false)}>{tx("使用中","Active")}</Button><Button variant={showArchived?"default":"secondary"} aria-pressed={showArchived} onClick={()=>setShowArchived(true)}>{tx("已归档","Archived")}</Button></div>}
      {tab==="课程"&&<section data-od-id="learning-structure-guide" className="mt-4 rounded-lg border border-border bg-surface px-5 py-4"><h2 className="font-semibold">{t("按章节编排课程")}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("新建课程后添加讲解、练习与检查点；草稿仅维护教师可见，发布后本校学生可学习。课程不会自动创建班级、作业或训练。")}</p></section>}
      <section className={`${panel} mt-4`}>
        {tab === "课程" ? (
          <>
            <State resource={paths} />
            <div data-od-id="learning-path-table" className="min-w-0 [&_th]:whitespace-nowrap [&_td:not(:first-child)]:whitespace-nowrap [&_th:first-child]:w-[42%] [&_td:first-child]:min-w-[300px] [&_th:nth-child(2)]:w-[12%] [&_th:nth-child(3)]:w-[7%] [&_th:nth-child(4)]:w-[14%] [&_th:nth-child(5)]:w-[9%] [&_th:last-child]:w-[16%] [&_td:first-child_p]:max-w-md">
            <Table min={1000}
              headers={[t("课程名称"), t("分类"), t("章节"), t("可见范围"), t("状态"), t("操作")]}
            >
              {paths.data?.items.map((path) => (
                <tr key={path.id}>
                  <td>
                    <div className="mb-2 w-36"><LearningCover coverKey={path.coverKey}/></div><Link className="font-semibold text-primary hover:underline" href={`/teacher/courses/${path.id}`}>{path.title}</Link><p className="mt-1 text-xs text-muted-foreground">{t(courseDifficulties[path.difficulty??"beginner"])}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {path.description}
                    </p>
                  </td>
                  <td>{path.category}</td>
                  <td>{path.chapterCount}</td>
                  <td>{path.archived?tx("已归档","Archived"):path.published ? t("本校学生") : t("维护教师草稿")}</td>
                  <td>
                    <StatusPill status={path.archived?tx("已归档","Archived"):path.published ? t("已发布") : t("草稿")} />
                  </td>
                  <td>
                    <Link className={link} href={`/teacher/courses/${path.id}`}>
                      {path.archived?tx("查看","View"):path.canEdit ? t("编辑") : t("查看")}
                    </Link>
                    {!path.archived&&<Link className={`${link} ml-4`} href={`/teacher/courses/${path.id}?preview=1`}>{t("学生预览")}</Link>}
                    {path.canEdit&&<Button size="sm" variant="ghost" disabled={action.busy} onClick={()=>setArchiveTarget(path)}>{path.archived?tx("恢复","Restore"):tx("归档","Archive")}</Button>}
                  </td>
                </tr>
              ))}
              {!paths.loading && !paths.data?.items.length && (
                <Empty columns={6}>
                  {showArchived?tx("暂无已归档课程。","No archived courses."):t("暂无课程。点击“新建课程”组织章节内容。")}
                </Empty>
              )}
            </Table>
            </div>
          </>
        ) : (
          <>
            <State resource={resources} />
            <Table
              headers={[
                t("类型"),
                t("标题"),
                t("关联课程 / 章节"),
                t("可见范围"),
                t("内容 / 操作"),
              ]}
              min={760}
            >
              {resources.data?.items.map((r) => (
                <tr key={r.id}>
                  <td>{t(({note:"说明",article:"代码片段",reference:"参考资料"} as Record<string,string>)[r.type]??r.type)}</td>
                  <td><button type="button" className="font-semibold text-primary hover:underline focus-visible:underline" onClick={() => setEditing(r)}>{r.title}</button></td>
                  <td>
                    {paths.data?.items.find((x) => x.id === r.pathId)?.title ??
                      t("独立资料")}
                  </td>
                  <td>{r.scope === "school" ? t("本校学生") : t("维护教师")}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(r)}
                    >
                      {t("查看 / 编辑")}
                    </Button>
                    {r.canEdit !== false && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() => {
                          if (
                            window.confirm(t("删除此资料？课程和题目保留。"))
                          )
                            void action.run(async () => {
                              await productionApi(
                                `learning-resources/${r.id}`,
                                { method: "DELETE" },
                              );
                              resources.reload();
                              return t("资料已删除。");
                            });
                        }}
                      >
                        {t("删除")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!resources.loading && !resources.data?.items.length && (
                <Empty columns={5}>
                  {t("暂无资料。添加说明或代码片段帮助学生复习。")}
                </Empty>
              )}
            </Table>
          </>
        )}
      </section>
      {archiveTarget&&<Modal title={archiveTarget.archived?tx("恢复课程","Restore course"):tx("归档课程","Archive course")} onClose={()=>setArchiveTarget(null)}>
        <p className="text-sm text-muted-foreground">{archiveTarget.archived?tx("恢复后课程将回到使用中列表。已发布课程的关联题目仍需保持管理员审核通过。","Restoring a published course requires its linked problems to remain approved."):tx("归档后课程从学生课程列表移除。章节与学习进度保留；已发布作业仍可独立查看。","Archiving removes the course from the student catalog. Lessons and progress remain recorded; published assignments remain available independently.")}</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={()=>setArchiveTarget(null)}>{tx("取消","Cancel")}</Button><Button disabled={action.busy} onClick={()=>void action.run(async()=>{await productionApi(`learning-paths/${archiveTarget.id}${archiveTarget.archived?"/restore":""}`,archiveTarget.archived?{method:"POST",body:{}}:{method:"PATCH",body:{archived:true}});setArchiveTarget(null);paths.reload();return archiveTarget.archived?tx("课程已恢复。","Course restored."):tx("课程已归档。","Course archived.");})}>{archiveTarget.archived?tx("恢复","Restore"):tx("归档","Archive")}</Button></div>
      </Modal>}
      {create &&
        (tab === "课程" ? (
          <CreatePath
            onClose={() => setCreate(false)}
            onCreated={(id) => router.push(`/teacher/courses/${id}`)}
          />
        ) : (
          <ResourceEditor
            paths={paths.data?.items ?? []}
            onClose={() => setCreate(false)}
            onSaved={() => {
              setCreate(false);
              resources.reload();
            }}
          />
        ))}
      {editing && (
        <ResourceEditor
          initial={editing}
          paths={paths.data?.items ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            resources.reload();
          }}
        />
      )}
    </>
  );
}
function CreatePath({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const action = useAction();
  const {t} = useLocale();
  return (
    <Modal title={t("新建课程")} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void action.run(async () => {
            const result = await productionApi<Path>("learning-paths", {
              method: "POST",
              body: {
                title: d.get("title"),
                description: d.get("description"),
                category: d.get("category"),
                estimatedMinutes: Number(d.get("minutes")),
                difficulty: d.get("difficulty"),
                coverKey: d.get("coverKey"),
              },
            });
            onCreated(result.id);
          });
        }}
      >
        <Field label={t("课程名称")}>
          <input
            autoFocus
            name="title"
            required
            className={input}
            placeholder={t("输入课程名称")}
          />
        </Field>
        <Field label={t("简介")}>
          <textarea name="description" rows={3} className={area} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("分类")}>
            <select name="category" className={input}>
              {["Python", "ACSL", "CIE 9618", "Programming"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label={t("预计学习时间（分钟）")}>
            <input
              name="minutes"
              type="number"
              min={1}
              max={10080}
              defaultValue={60}
              className={input}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("课程难度")}>
            <select name="difficulty" className={input}>
              {Object.entries(courseDifficulties).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
            </select>
          </Field>
          <Field label={t("课程封面")}>
            <select name="coverKey" className={input}>
              {Object.entries(courseCovers).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("先创建草稿并添加章节，检查内容后发布给本校学生。")}
        </p>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("取消")}
          </Button>
          <Button disabled={action.busy}>{t("创建并编辑")}</Button>
        </div>
      </form>
    </Modal>
  );
}
function ResourceEditor({
  initial,
  paths,
  onClose,
  onSaved,
}: {
  initial?: Resource | undefined;
  paths: Path[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const action = useAction();
  const {t} = useLocale();
  return (
    <Modal title={initial ? t("编辑学习资料") : t("添加学习资料")} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void action.run(async () => {
            await productionApi(
              initial
                ? `learning-resources/${initial.id}`
                : "learning-resources",
              {
                method: initial ? "PATCH" : "POST",
                body: {
                  type: d.get("type"),
                  title: d.get("title"),
                  content: d.get("content"),
                  pathId: d.get("pathId") || null,
                  scope: d.get("scope"),
                },
              },
            );
            onSaved();
          });
        }}
      >
        <Field label={t("名称")}>
          <input
            name="title"
            required
            defaultValue={initial?.title}
            className={input}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("类型")}>
            <select
              name="type"
              defaultValue={initial?.type ?? "note"}
              className={input}
            >
              {[
                ["note", "说明"],
                ["article", "代码片段"],
                ["reference", "参考资料"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("可见范围")}>
            <select
              name="scope"
              defaultValue={initial?.scope ?? "private"}
              className={input}
            >
              <option value="private">{t("维护教师")}</option>
              <option value="school">{t("本校学生")}</option>
            </select>
          </Field>
        </div>
        <Field label={t("关联课程")}>
          <select
            name="pathId"
            defaultValue={initial?.pathId ?? ""}
            className={input}
          >
            <option value="">{t("独立资料")}</option>
            {paths.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("内容")}>
          <textarea
            name="content"
            required
            rows={8}
            defaultValue={initial?.content}
            className={area}
          />
        </Field>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("取消")}
          </Button>
          <Button disabled={action.busy || initial?.canEdit === false}>
            {t("保存资料")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TeacherLearningEditor({ id }: { id: string }) {
  const resource = useData<Path>(`learning-paths/${id}`);
  const reload = resource.reload;
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [id, reload]);
  return (
    <>
      <State resource={resource} />
      {resource.data && (
        <LearningEditorForm
          key={resource.data.id}
          initial={resource.data}
          onSaved={resource.reload}
        />
      )}
    </>
  );
}
function LearningEditorForm({
  initial,
  onSaved,
}: {
  initial: Path;
  onSaved: () => void;
}) {
  const {t, locale} = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const search = useSearchParams(),
    [path, setPath] = useState(initial),
    [chapters, setChapters] = useState(initial.chapters ?? []),
    [current, setCurrent] = useState(
      search.get("chapter") ?? initial.chapters?.[0]?.id ?? "",
    ),
    [preview, setPreview] = useState(search.get("preview") === "1"),
    [picker, setPicker] = useState(false),
    [metadata, setMetadata] = useState(false),
    [progressOpen,setProgressOpen]=useState(false),
    [publish, setPublish] = useState(false),
    [batchPublishOpen, setBatchPublishOpen] = useState(false),
    [batchPublishLoading, setBatchPublishLoading] = useState(false),
    [batchPublishError, setBatchPublishError] = useState(""),
    [batchCandidates, setBatchCandidates] = useState<CoursePublishCandidate[] | null>(null),
    [batchSelected, setBatchSelected] = useState<string[]>([]),
    batchAction = useAction(),
    action = useAction();
  const localCourse = useRef({ path, chapters });
  useEffect(() => { localCourse.current = { path, chapters }; }, [path, chapters]);
  useEffect(() => {
    const previous = localCourse.current;
    setPath(initial);
    setChapters(mergeReviewStatus(previous.chapters, previous.path.chapters ?? [], initial.chapters ?? []));
  }, [initial]);
  const canEditCourse = path.canEdit && !path.archived;
  useEffect(() => {
    if (!path.archived) return;
    setMetadata(false);
    setPublish(false);
    setPicker(false);
    setBatchPublishOpen(false);
  }, [path.archived]);
  const chapter = chapters.find((x) => x.id === current) ?? chapters[0],
    selectedIndex = chapters.findIndex((x) => x.id === chapter?.id),
    dirty = JSON.stringify(chapters) !== JSON.stringify(path.chapters ?? []);
  const linkedByProblem = new Map<string, ChapterProblem[]>();
  for (const problem of chapters.flatMap((item) => item.problems)) {
    linkedByProblem.set(problem.problemId, [...(linkedByProblem.get(problem.problemId) ?? []), problem]);
  }
  const linkedProblemCount = linkedByProblem.size;
  const linkedStatus = [...linkedByProblem.values()].map((versions) => {
    if (versions.every(courseProblemReady)) return "approved";
    if (versions.some((problem) => !problem.published)) return "draft";
    if (versions.some((problem) => ["rejected", "revoked"].includes(problem.rankReviewStatus ?? ""))) return "revision";
    return "review";
  });
  const unpublishedProblems = linkedStatus.filter((status) => status === "draft").length;
  const reviewingProblems = linkedStatus.filter((status) => status === "review").length;
  const revisionProblems = linkedStatus.filter((status) => status === "revision").length;
  const approvedProblems = linkedStatus.filter((status) => status === "approved").length;
  const pendingProblems = linkedProblemCount - approvedProblems;
  const savedUnpublishedProblems = new Set((path.chapters ?? []).flatMap((item) => item.problems)
    .filter((problem) => !problem.published).map((problem) => problem.problemId)).size;
  useDirty(dirty);
  const update = <K extends keyof Chapter>(key: K, value: Chapter[K]) =>
    setChapters((xs) =>
      xs.map((x) => (x.id === chapter?.id ? { ...x, [key]: value } : x)),
    );
  const save = async () => {
    if (!canEditCourse) throw new Error(tr("已归档课程只能查看；请先在课程列表中恢复。", "Archived courses are read-only. Restore the course from the list first."));
    for (let position = 0; position < chapters.length; position++) {
      const item = chapters[position]!;
      const result = await productionApi<Chapter>(
        item.id.startsWith("new-")
          ? `learning-paths/${path.id}/chapters`
          : `chapters/${item.id}`,
        {
          method: item.id.startsWith("new-") ? "POST" : "PATCH",
          body: {
            title: item.title,
            content: item.content,
            objective: item.objective ?? "",
            checkpoint: item.checkpoint ?? "",
            checkpointAnswer: item.checkpointAnswer ?? "",
            position,
            problemIds: item.problems.map((x) => x.problemId),
          },
        },
      );
      const previousId = item.id;
      if (previousId === current) setCurrent(result.id);
      // Preserve each successful creation so a later failure can be retried without duplicating chapters.
      setChapters((currentChapters) =>
        currentChapters.map((chapter) =>
          chapter.id === previousId ? { ...chapter, id: result.id } : chapter,
        ),
      );
    }
    const fresh = await productionApi<Path>(`learning-paths/${path.id}`);
    setPath(fresh);
    setChapters(fresh.chapters ?? []);
    onSaved();
    return fresh;
  };
  const openBatchPublish = async () => {
    if (!canEditCourse) return;
    setBatchPublishOpen(true);
    setBatchPublishLoading(true);
    setBatchPublishError("");
    setBatchCandidates(null);
    setBatchSelected([]);
    batchAction.clear();
    try {
      // Inspect saved course links: unsaved edits in this form must never be
      // written or discarded as a side effect of publishing problem versions.
      const [savedPath, problemList] = await Promise.all([
        productionApi<Path>(`learning-paths/${path.id}`),
        productionApi<{ items: ProductionProblem[] }>("problems"),
      ]);
      const linked = new Map<string, { problem: ChapterProblem; conflicting: boolean }>();
      for (const item of savedPath.chapters ?? []) {
        for (const problem of item.problems) {
          const previous = linked.get(problem.problemId);
          if (!previous) linked.set(problem.problemId, { problem, conflicting: false });
          else if (previous.problem.versionId !== problem.versionId) previous.conflicting = true;
        }
      }
      const latest = new Map(problemList.items.map((problem) => [problem.id, problem]));
      const missing = [...linked.keys()].filter((problemId) => !latest.has(problemId));
      const missingResults = await Promise.allSettled(
        missing.map((problemId) => productionApi<ProductionProblem>(`problems/${problemId}`)),
      );
      missingResults.forEach((result, index) => {
        if (result.status === "fulfilled") latest.set(missing[index]!, result.value);
      });
      const candidates = [...linked].map(([problemId, { problem, conflicting }]): CoursePublishCandidate => {
        const currentProblem = latest.get(problemId);
        const status: CoursePublishCandidate["status"] = conflicting
          ? "conflicting-links"
          : problem.published
            ? "published"
            : !currentProblem || !currentProblem.canEdit
              ? "no-access"
              : currentProblem.versionId !== problem.versionId
                ? "version-changed"
                : currentProblem.validationStatus !== "AC" || !currentProblem.canPublish
                  ? "not-validated"
                  : "ready";
        return { problemId, versionId: problem.versionId, title: problem.title,
          bankName: problem.bankName, rankReviewStatus: problem.rankReviewStatus, status };
      });
      setBatchCandidates(candidates);
      setBatchSelected(candidates.filter((item) => item.status === "ready").slice(0, 100).map((item) => item.problemId));
    } catch (error) {
      setBatchPublishError(error instanceof Error ? error.message : tr("无法检查课程题目，请重试。", "Could not inspect course problems. Please retry."));
    } finally {
      setBatchPublishLoading(false);
    }
  };
  const publishBatch = () => {
    if (!canEditCourse || !batchCandidates || !batchSelected.length) return;
    const chosen = batchCandidates.filter((item) => item.status === "ready" && batchSelected.includes(item.problemId));
    if (!chosen.length || chosen.length > 100) return;
    void batchAction.run(async () => {
      const result = await productionApi<{ publishedCount: number }>("problems/publish-batch", {
        method: "POST",
        body: { items: chosen.map(({ problemId, versionId }) => ({ problemId, versionId })) },
      });
      let fresh: Path;
      try {
        fresh = await productionApi<Path>(`learning-paths/${path.id}`);
      } catch {
        // The publish transaction has committed even if this follow-up read
        // fails. Keep the confirmation truthful and refresh when possible.
        setBatchPublishOpen(false);
        onSaved();
        return tr(`已发布 ${result.publishedCount} 道题目版本；课程状态暂未刷新，请重新打开页面查看审核状态。`,
          `Published ${result.publishedCount} problem versions. Reopen the course to refresh their review status.`);
      }
      setPath(fresh);
      setChapters((local) => mergeReviewStatus(local, path.chapters ?? [], fresh.chapters ?? []));
      setBatchPublishOpen(false);
      onSaved();
      return tr(`已发布 ${result.publishedCount} 道题目版本，待管理员审核公开。课程仍保持原状态。`,
        `Published ${result.publishedCount} problem versions for admin review. The course status has not changed.`);
    });
  };
  return (
    <>
      <Link
        href="/teacher/courses"
        className={`${link} mb-4 inline-block text-sm`}
      >
        ← {t("课程")}
      </Link>
      <PageHeader
        eyebrow={t("课程编辑")}
        title={path.title}
        description={tr("课程草稿可先关联校内题库的草稿题；发布课程前，所有关联题须已发布并通过管理员公开审核。", "A course draft can link draft problems in school banks. Before publishing the course, every linked problem must be published and approved for school-wide access.")}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPreview(true)}>
              <Eye size={15} />
              {t("学生预览")}
            </Button>
            <Button
              disabled={action.busy || !canEditCourse}
              onClick={() =>
                void action.run(async () => {
                  await save();
                  return t("课程章节已保存。");
                })
              }
            >
              {t("保存草稿")}
            </Button>
            <Button
              variant="secondary"
              disabled={action.busy || !canEditCourse || path.published || pendingProblems > 0}
              onClick={() => setPublish(true)}
            >
              {path.archived ? tr("已归档", "Archived") : path.published ? t("已发布") : t("发布")}
            </Button>
          </div>
        }
      />
      <Feedback action={action} />
      {!batchPublishOpen && <Feedback action={batchAction} />}
      {path.archived && <p role="status" className="mt-4 rounded-md border border-border bg-surface-subtle px-4 py-3 text-sm text-muted-foreground">{tr("课程已归档，目前只可查看。若需继续修改、发布课程或关联题目，请先在课程列表中恢复。", "This course is archived and read-only. Restore it from the course list before editing or publishing.")}</p>}
      {!path.archived && !path.published && (
        <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${pendingProblems ? "border-warning/30 bg-warning-soft text-warning" : "border-border bg-surface-subtle text-muted-foreground"}`}>
          <div className="min-w-0 flex-1 space-y-1">
            <p>
              {linkedProblemCount > 0
                ? tr(`课程关联 ${linkedProblemCount} 题：${approvedProblems} 题已审核公开 · ${reviewingProblems} 题已发布待审核 · ${unpublishedProblems} 题未发布 · ${revisionProblems} 题需新修订版。`,
                  `${linkedProblemCount} linked: ${approvedProblems} approved · ${reviewingProblems} published and awaiting review · ${unpublishedProblems} unpublished · ${revisionProblems} need a new revision.`)
                : tr("课程草稿尚未关联题目。", "This draft has no linked problems yet.")}
            </p>
            <p className="text-xs opacity-85">
              {unpublishedProblems > 0
                ? tr("仅未发布题目可在验证后批量发布；已发布题目无需重复提交。", "Only unpublished, validated problems can be published in a batch. Published versions must not be resubmitted.")
                : reviewingProblems > 0
                  ? tr("已发布题目正等待管理员审核，无需再次发布。", "Published versions are awaiting administrator review. No further publication is needed.")
                  : revisionProblems > 0
                    ? tr("未通过或已撤下的题目需要创建新修订版，并重新验证、发布和审核。", "Rejected or withdrawn problems need a new revision, validation, publication, and review.")
                    : tr("关联题目已审核公开，课程可以发布。", "Linked problems are approved and public; this course can be published.")}
            </p>
            <p className="text-xs opacity-85">{tr("审核只对当前关联的具体题目版本有效；同名题和其他题库的审核结果不会继承。", "Approval applies only to the exact linked problem version. A same-titled problem in another bank does not inherit it.")}</p>
          </div>
          {canEditCourse && savedUnpublishedProblems > 0 && (
            <Button size="sm" variant="secondary" disabled={batchPublishLoading || batchAction.busy} onClick={() => void openBatchPublish()}>
              {tr("批量发布未发布题目", "Publish unpublished problems")}
            </Button>
          )}
        </div>
      )}
      <div className="mt-4 grid items-center gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[180px_1fr]"><LearningCover coverKey={path.coverKey}/><div><p className="font-semibold">{t(courseDifficulties[path.difficulty??"beginner"])} · {chapters.length} {t("章")}</p><p className="mt-2 text-sm text-muted-foreground">{path.estimatedMinutes??30} {t("分钟 · 阅读与练习进度独立统计")}</p><Button variant="secondary" size="sm" className="mt-3" disabled={!path.canEdit} onClick={()=>setProgressOpen(true)}>{t("查看学生进度总览")}</Button></div></div>
      {progressOpen&&<LearningProgressDialog id={path.id} onClose={()=>setProgressOpen(false)}/>}
      {canEditCourse&&canUseLegacyPythonPractice(path)&&<PythonPracticePanel id={path.id} bundle={path.practiceBundle??[]} disabled={dirty||action.busy} onRefreshStatus={async()=>{const fresh=await productionApi<Path>(`learning-paths/${path.id}`);setPath(current=>({...current,practiceBundle:fresh.practiceBundle}));}} onUpdated={async()=>{const fresh=await productionApi<Path>(`learning-paths/${path.id}`);setPath(fresh);setChapters(fresh.chapters??[]);}}/>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Button size="sm" variant="secondary" onClick={()=>{const doc:LearningDocument={format:"codemaster-learning-path",version:1,title:path.title,description:path.description,category:path.category,estimatedMinutes:path.estimatedMinutes??30,difficulty:path.difficulty??"beginner",coverKey:path.coverKey??"general",chapters:chapters.map(c=>({title:c.title,content:c.content,objective:c.objective??"",checkpoint:c.checkpoint??"",checkpointAnswer:c.checkpointAnswer??"",problemIds:c.problems.map(p=>p.problemId)}))};void action.run(async()=>{downloadLearningMarkdown(doc);return t("已导出当前编辑内容（包括未保存修改）。");});}}>{t("导出 Markdown")}</Button>
        <Button size="sm" variant="secondary" disabled={!canEditCourse} onClick={() => setMetadata(true)}>
          {t("课程资料")}
        </Button>
        {dirty && <span className="text-warning">{t("有未保存修改")}</span>}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={`${panel} self-start lg:sticky lg:top-5`}>
          <div className="flex justify-between border-b border-border p-3">
            <b>{t("章节")}</b>
            <Button
              size="sm"
              disabled={!canEditCourse}
              onClick={() => {
                const id = `new-${crypto.randomUUID()}`;
                setChapters((x) => [
                  ...x,
                  {
                    id,
                    title: t("新章节"),
                    content: "",
                    position: x.length,
                    objective: "",
                    checkpoint: "",
                    checkpointAnswer: "",
                    problems: [],
                  },
                ]);
                setCurrent(id);
              }}
            >
              <Plus size={14} />
              {t("新增")}
            </Button>
          </div>
          <div className="max-h-[60dvh] overflow-y-auto">{chapters.map((x, i) => (
            <button
              key={x.id}
              onClick={() => setCurrent(x.id)}
              className={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left text-sm leading-5 ${x.id === chapter?.id ? "bg-accent font-semibold text-primary" : ""}`}
            >
              <span className="min-w-0 flex-1 break-words">
                {chapterDirectoryTitle(x.title, i)}
              </span>
              <span className="shrink-0 whitespace-nowrap text-xs leading-5 tabular-nums text-muted-foreground">{x.problems.length} {t("题")}</span>
            </button>
          ))}
          </div>
          {!chapters.length && (
            <p className="p-4 text-sm text-muted-foreground">
              {t("暂无章节，点击“新增”开始编写。")}
            </p>
          )}
        </aside>
        {chapter && (
          <section className={`${panel} p-5`}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={t("章节名称")}
                value={chapter.title}
                onChange={(e) => update("title", e.target.value)}
                className={`${input} min-w-48 flex-1 font-bold`}
                disabled={!canEditCourse}
              />
              <Button
                size="icon"
                variant="secondary"
                title={t("章节上移")}
                disabled={selectedIndex === 0 || !canEditCourse}
                onClick={() => setChapters(move(chapters, selectedIndex, -1))}
              >
                <ArrowUp size={15} />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                title={t("章节下移")}
                disabled={
                  selectedIndex === chapters.length - 1 || !canEditCourse
                }
                onClick={() => setChapters(move(chapters, selectedIndex, 1))}
              >
                <ArrowDown size={15} />
              </Button>
              <Button
                variant="ghost"
                disabled={action.busy || !canEditCourse}
                onClick={() => {
                  if (window.confirm(t("从本课程移除此章节？题库题目保留。")))
                    void action.run(async () => {
                      if (!chapter.id.startsWith("new-"))
                        await productionApi(`chapters/${chapter.id}`, {
                          method: "DELETE",
                        });
                      setChapters((x) => x.filter((c) => c.id !== chapter.id));
                      setCurrent(
                        chapters.find((x) => x.id !== chapter.id)?.id ?? "",
                      );
                      onSaved();
                      return t("章节已移除，题库题目保留。");
                    });
                }}
              >
                <Trash2 size={15} />
                {t("移除章节")}
              </Button>
            </div>
            <div className="mt-5 grid gap-4">
              <Field label={t("学习目标")}>
                <textarea
                  value={chapter.objective ?? ""}
                  onChange={(e) => update("objective", e.target.value)}
                  rows={2}
                  readOnly={!canEditCourse}
                  className={area}
                />
              </Field>
              <Field label={t("正文 · Markdown 讲解与示例")}>
                <textarea
                  value={chapter.content}
                  onChange={(e) => update("content", e.target.value)}
                  rows={12}
                  readOnly={!canEditCourse}
                  className={area}
                />
              </Field>
              <section className="border border-border">
                <div className="flex justify-between gap-3 bg-surface-subtle p-3">
                  <div>
                    <b>{t("练习引用")}</b>
                    <p className="text-xs text-muted-foreground">
                      {t("从题库与分组选择；只存引用，不复制题面与测试。")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canEditCourse && !path.published && savedUnpublishedProblems > 0 && (
                      <Button size="sm" variant="secondary" disabled={batchPublishLoading || batchAction.busy} onClick={() => void openBatchPublish()}>
                        {tr("批量发布未发布题目", "Publish unpublished")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!canEditCourse}
                      onClick={() => setPicker(true)}
                    >
                      <Plus size={14} />
                      {t("添加练习")}
                    </Button>
                  </div>
                </div>
                {chapter.problems.map((p, i) => (
                  <div
                    key={p.problemId}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link
                        href={`/teacher/problems/${p.problemId}/edit`}
                        className={link}
                      >
                        {p.title}
                      </Link>
                      {p.bankName && <span className="text-xs text-muted-foreground">{tr("题库", "Bank")}：{p.bankName}</span>}
                      <span className={`rounded border px-2 py-0.5 text-xs font-medium ${courseProblemReady(p) ? "border-success/25 bg-success-soft text-success" : "border-warning/25 bg-warning-soft text-warning"}`}>
                        {courseProblemReady(p)
                          ? tr("已审核公开", "Approved and public")
                          : !p.published
                            ? tr("题目草稿", "Problem draft")
                            : p.rankReviewStatus === "rejected"
                              ? tr("公开审核未通过", "Review rejected")
                              : p.rankReviewStatus === "revoked"
                                ? tr("已撤下", "Withdrawn")
                                : tr("已发布 · 待管理员审核", "Published · awaiting admin review")}
                      </span>
                    </div>
                    <span className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t("练习上移")}
                        disabled={i === 0 || !canEditCourse}
                        onClick={() =>
                          update("problems", move(chapter.problems, i, -1))
                        }
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t("练习下移")}
                        disabled={i === chapter.problems.length - 1 || !canEditCourse}
                        onClick={() =>
                          update("problems", move(chapter.problems, i, 1))
                        }
                      >
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canEditCourse}
                        onClick={() =>
                          update(
                            "problems",
                            chapter.problems.filter(
                              (x) => x.problemId !== p.problemId,
                            ),
                          )
                        }
                      >
                        {t("移除引用")}
                      </Button>
                    </span>
                  </div>
                ))}
              </section>
              <Field label={t("检查点 · 独立练习")}>
                <textarea
                  value={chapter.checkpoint ?? ""}
                  onChange={(e) => update("checkpoint", e.target.value)}
                  rows={3}
                  readOnly={!canEditCourse}
                  className={area}
                />
              </Field>
              <Field label={t("检查点参考答案")}>
                <textarea
                  value={chapter.checkpointAnswer ?? ""}
                  onChange={(e) => update("checkpointAnswer", e.target.value)}
                  rows={3}
                  readOnly={!canEditCourse}
                  className={area}
                />
              </Field>
            </div>
          </section>
        )}
      </div>
      {picker && chapter && canEditCourse && (
        <ProblemPicker
          courseMode={path.published ? "published" : "draft"}
          selected={chapter.problems.map((x) => x.problemId)}
          onClose={() => setPicker(false)}
          onAdd={(items) => {
            update("problems", [
              ...chapter.problems,
              ...items.map((x) => ({
                problemId: x.id,
                title: x.title,
                versionId: x.versionId ?? "",
                published: x.published,
                schoolVisibleAt: x.schoolVisibleAt,
                rankReviewStatus: x.rankReviewStatus,
                readyForCourse: Boolean(x.published && x.schoolVisibleAt && x.rankReviewStatus === "approved"),
              })),
            ]);
            setPicker(false);
          }}
        />
      )}
      {preview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
          <div className="sticky top-0 flex justify-between border-b border-border bg-surface p-4">
            <div>
              <b>{t("学生预览")} · {chapter?.title}</b>
              <p className="text-xs text-muted-foreground">{tr("当前编辑内容 · 未发布题目仅供教师预览", "Current edits · unpublished problems are visible to teachers only")}</p>
            </div>
            <Button variant="secondary" onClick={() => setPreview(false)}>
              ← {t("返回原编辑位置")}
            </Button>
          </div>
          <article className="mx-auto max-w-3xl p-8">
            <h1 className="text-2xl font-bold">{chapter?.title}</h1>
            <p className="mt-4 text-sm text-primary">{chapter?.objective}</p>
            <div className="mt-6"><LessonContent content={chapter?.content??""}/></div>
            {chapter?.checkpoint && (
              <section className="mt-6 border border-primary/30 bg-info-soft p-5">
                <h2 className="font-bold">{t("检查点")}</h2>
                <div className="mt-3"><LessonContent content={chapter.checkpoint}/></div>
                <details className="mt-4 text-sm">
                  <summary>{t("查看参考答案")}</summary>
                  <div className="mt-3"><LessonContent content={chapter.checkpointAnswer??""}/></div>
                </details>
              </section>
            )}
            <h2 className="mt-6 font-bold">{t("相关练习")}</h2>
            {chapter?.problems.map((x) => (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-primary" key={x.problemId}>
                <span>{x.title}</span>
                {!courseProblemReady(x) && <span className="rounded border border-warning/25 bg-warning-soft px-2 py-0.5 text-xs text-warning">{tr("仅供教师预览", "Teacher preview only")}</span>}
              </p>
            ))}
          </article>
        </div>
      )}
      {metadata && canEditCourse && (
        <Modal title={t("课程资料")} onClose={() => setMetadata(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void action.run(async () => {
                await productionApi(`learning-paths/${path.id}`, {
                  method: "PATCH",
                  body: {
                    title: d.get("title"),
                    category: d.get("category"),
                    description: d.get("description"),
                    difficulty:d.get("difficulty"),coverKey:d.get("coverKey"),
                    estimatedMinutes: Number(d.get("minutes")),
                  },
                });
                setPath((x) => ({
                  ...x,
                  title: String(d.get("title")),
                  category: String(d.get("category")),
                  description: String(d.get("description")),
                  estimatedMinutes:Number(d.get("minutes")),difficulty:String(d.get("difficulty")) as keyof typeof courseDifficulties,coverKey:String(d.get("coverKey")) as keyof typeof courseCovers,
                }));
                setMetadata(false);
                onSaved();
              });
            }}
          >
            <Field label={t("名称")}>
              <input
                name="title"
                required
                defaultValue={path.title}
                className={input}
              />
            </Field>
            <Field label={t("课程标签")}>
              <input
                name="category"
                required
                defaultValue={path.category}
                className={input}
              />
            </Field>
            <Field label={t("课程难度")}><select name="difficulty" defaultValue={path.difficulty??"beginner"} className={input}>{Object.entries(courseDifficulties).map(([v,l])=><option key={v} value={v}>{t(l)}</option>)}</select></Field>
            <Field label={t("课程封面")}><select name="coverKey" defaultValue={path.coverKey??"general"} className={input}>{Object.entries(courseCovers).map(([v,l])=><option key={v} value={v}>{t(l)}</option>)}</select></Field>
            <Field label={t("简介")}>
              <textarea
                name="description"
                defaultValue={path.description}
                className={area}
              />
            </Field>
            <Field label={t("预计学习时间（分钟）")}>
              <input
                name="minutes"
                type="number"
                min={0}
                max={10000}
                defaultValue={path.estimatedMinutes ?? 60}
                className={input}
              />
            </Field>
            <Feedback action={action} />
            <Button disabled={action.busy}>{t("保存课程资料")}</Button>
          </form>
        </Modal>
      )}
      {publish && canEditCourse && (
        <Modal title={t("确认发布课程")} onClose={() => setPublish(false)}>
          <p className="text-sm">
            {t("发布后，本校学生可阅读章节并练习关联的已发布题目。")}
          </p>
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPublish(false)}>
              {t("取消")}
            </Button>
            <Button
              disabled={action.busy || !chapters.length}
              onClick={() =>
                void action.run(async () => {
                  await save();
                  await productionApi(`learning-paths/${path.id}/publish`, {
                    method: "POST",
                  });
                  setPath((x) => ({ ...x, published: true }));
                  onSaved();
                  setPublish(false);
                  return t("课程已发布。");
                })
              }
            >
              {t("确认发布")}
            </Button>
          </div>
        </Modal>
      )}
      {batchPublishOpen && canEditCourse && (
        <Modal title={tr("批量发布课程题目", "Publish course problems in a batch")} onClose={() => { if (!batchAction.busy) setBatchPublishOpen(false); }} wide>
          <p className="text-sm text-muted-foreground">
            {tr("只选择本课程已保存且尚未发布的题目版本。已发布和已审核版本不能再次提交；审核以具体版本为准，不会因题名相同而继承。", "Only saved, unpublished linked versions can be selected. Published and approved versions cannot be resubmitted; approval belongs to the exact version, not to the title.")}
          </p>
          {dirty && <p className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            {tr("课程有未保存修改。本次仅处理服务器上已保存的题目引用；当前编辑内容会保留。", "The course has unsaved edits. This action includes only saved links; your current edits will remain intact.")}
          </p>}
          {batchPublishLoading ? <p role="status" className="mt-4 text-sm text-muted-foreground">{tr("正在核对关联题目和最新版本…", "Checking linked problems and latest versions…")}</p> : batchPublishError ? (
            <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {batchPublishError} <Button size="sm" variant="secondary" className="ml-2" onClick={() => void openBatchPublish()}>{tr("重试", "Retry")}</Button>
            </div>
          ) : batchCandidates && (
            <>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <p>{tr(`关联 ${batchCandidates.length} 题 · 可发布 ${batchCandidates.filter((item) => item.status === "ready").length} 题 · 已发布 ${batchCandidates.filter((item) => item.status === "published").length} 题 · 暂不可发布 ${batchCandidates.filter((item) => !["ready", "published"].includes(item.status)).length} 题 · 已选 ${batchSelected.length} 题`,
                  `${batchCandidates.length} linked · ${batchCandidates.filter((item) => item.status === "ready").length} ready · ${batchCandidates.filter((item) => item.status === "published").length} published · ${batchCandidates.filter((item) => !["ready", "published"].includes(item.status)).length} unavailable · ${batchSelected.length} selected`)}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={batchAction.busy} onClick={() => setBatchSelected(batchCandidates.filter((item) => item.status === "ready").slice(0, 100).map((item) => item.problemId))}>{tr("全选可发布", "Select ready")}</Button>
                  <Button size="sm" variant="ghost" disabled={batchAction.busy || !batchSelected.length} onClick={() => setBatchSelected([])}>{tr("清空选择", "Clear")}</Button>
                </div>
              </div>
              {batchCandidates.filter((item) => item.status === "ready").length > 100 && <p className="mt-2 text-xs text-muted-foreground">{tr("一次最多发布 100 题；完成后可继续发布剩余题目。", "You can publish up to 100 problems per batch. Run another batch for the rest.")}</p>}
              <div className="mt-3 max-h-[45dvh] overflow-y-auto rounded-md border border-border">
                {batchCandidates.map((item) => {
                  const status = item.status === "ready" ? tr("已验证，可发布", "Validated, ready")
                    : item.status === "published" ? item.rankReviewStatus === "approved"
                      ? tr("已审核公开，不可再次发布", "Approved and public; cannot republish")
                      : item.rankReviewStatus === "rejected"
                        ? tr("审核未通过，请创建新版本", "Review rejected; create a new revision")
                        : item.rankReviewStatus === "revoked"
                          ? tr("已撤下，请创建新版本", "Withdrawn; create a new revision")
                          : tr("已发布，待管理员审核；不可再次发布", "Published, awaiting admin review; cannot republish")
                    : item.status === "version-changed" ? tr("课程引用的不是最新版本；请先移除旧引用、保存，再重新添加", "The course links an older version. Remove it, save, then add the latest version.")
                    : item.status === "not-validated" ? tr("参考解尚未通过正式测试", "Reference solution has not passed formal tests")
                    : item.status === "conflicting-links" ? tr("不同章节引用了同题的不同版本，请先统一", "Chapters link different versions of this problem")
                    : tr("当前账号无法发布此题", "Your account cannot publish this problem");
                  return <label key={item.problemId} className={`flex items-start gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0 ${item.status === "ready" ? "cursor-pointer hover:bg-surface-subtle" : "text-muted-foreground"}`}>
                    <input type="checkbox" className="mt-1 size-4 accent-primary" disabled={item.status !== "ready" || batchAction.busy} checked={batchSelected.includes(item.problemId)} onChange={(event) => setBatchSelected((selected) => event.target.checked
                      ? selected.length >= 100 ? selected : [...selected, item.problemId]
                      : selected.filter((id) => id !== item.problemId))} />
                    <span className="min-w-0 flex-1"><span className="block break-words font-medium text-foreground">{item.title}</span><span className="mt-0.5 block text-xs">{item.bankName ? `${tr("题库", "Bank")}：${item.bankName} · ` : ""}{status}</span></span>
                  </label>;
                })}
                {!batchCandidates.length && <p className="p-4 text-sm text-muted-foreground">{tr("课程尚未保存关联题目。", "This course has no saved linked problems.")}</p>}
              </div>
              <Feedback action={batchAction} />
              {batchAction.error && <Button size="sm" variant="secondary" className="mt-2" disabled={batchAction.busy} onClick={() => void openBatchPublish()}>{tr("重新检查题目状态", "Check problem status again")}</Button>}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" disabled={batchAction.busy} onClick={() => setBatchPublishOpen(false)}>{tr("取消", "Cancel")}</Button>
                <Button disabled={batchAction.busy || !batchSelected.length} onClick={publishBatch}>
                  {batchAction.busy ? tr("正在发布…", "Publishing…") : tr(`确认发布 ${batchSelected.length} 题`, `Publish ${batchSelected.length} problems`)}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
