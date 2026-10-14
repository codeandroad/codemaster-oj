"use client";

import { AppLink as Link } from "@/components/navigation";
import {LessonContent} from "../student/shared";
import {LearningCover,courseCovers,courseDifficulties} from "@/components/learning-course";
import {PythonPracticePanel,type CoursePractice} from "./python-practice-panel";
import {LearningProgressDialog} from "./learning-progress";
import {LearningImport} from "./learning-import";
import {downloadLearningMarkdown,type LearningDocument} from "./learning-document";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, FilePlus2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { productionApi } from "@/lib/production-api";
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

interface Chapter {
  id: string;
  title: string;
  content: string;
  position: number;
  objective?: string;
  checkpoint?: string;
  checkpointAnswer?: string;
  problems: { problemId: string; title: string; versionId: string }[];
}
interface Path {
  id: string;
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
  const router = useRouter(),
    paths = useData<{ items: Path[] }>("learning-paths"),
    resources = useData<{ items: Resource[] }>("learning-resources"),
    [tab, setTab] = useState("学习路径"),
    [create, setCreate] = useState(false),
    [importing,setImporting]=useState(false),
    [editing, setEditing] = useState<Resource | null>(null),
    action = useAction();
  return (
    <>
      <PageHeader
        eyebrow="Learning Content"
        title="学习内容"
        description="用学习路径组织讲解、例题、练习与检查点；题库分组保持独立。"
        action={
          <div className="flex flex-wrap gap-2">{tab==="学习路径"&&<Button variant="secondary" onClick={()=>setImporting(true)}>导入 Markdown</Button>}
          <Button onClick={() => setCreate(true)}>
            {tab === "学习路径" ? <Plus size={15} /> : <FilePlus2 size={15} />}{" "}
            {tab === "学习路径" ? "新建学习路径" : "添加资料"}
          </Button></div>
        }
      />
      {importing&&<LearningImport onClose={()=>setImporting(false)} onImported={id=>{setImporting(false);router.push(`/teacher/learning/${id}`);}}/>}
      <Tabs items={["学习路径", "学习资料"]} value={tab} onChange={setTab} />
      <Feedback action={action} />
      {tab==="学习路径"&&<section data-od-id="learning-structure-guide" className="mt-4 rounded-lg border border-border bg-surface px-5 py-4"><h2 className="font-semibold">让课程结构与课堂节奏一致</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">每条路径包含有序章节，每章独立保存学习目标、Markdown 讲解、题库练习、检查点与参考答案。导入后先预览，再发布给学生。</p></section>}
      <section className={`${panel} mt-4`}>
        {tab === "学习路径" ? (
          <>
            <State resource={paths} />
            <div data-od-id="learning-path-table" className="min-w-0 [&_th]:whitespace-nowrap [&_td:not(:first-child)]:whitespace-nowrap [&_th:first-child]:w-[42%] [&_td:first-child]:min-w-[300px] [&_th:nth-child(2)]:w-[12%] [&_th:nth-child(3)]:w-[7%] [&_th:nth-child(4)]:w-[14%] [&_th:nth-child(5)]:w-[9%] [&_th:last-child]:w-[16%] [&_td:first-child_p]:max-w-md">
            <Table min={1000}
              headers={["名称", "课程标签", "章节", "适用范围", "状态", "操作"]}
            >
              {paths.data?.items.map((path) => (
                <tr key={path.id}>
                  <td>
                    <div className="mb-2 w-36"><LearningCover coverKey={path.coverKey}/></div><Link className="font-semibold text-primary hover:underline" href={`/teacher/learning/${path.id}`}>{path.title}</Link><p className="mt-1 text-xs text-muted-foreground">{courseDifficulties[path.difficulty??"beginner"]}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {path.description}
                    </p>
                  </td>
                  <td>{path.category}</td>
                  <td>{path.chapterCount}</td>
                  <td>{path.published ? "本校学生" : "维护教师草稿"}</td>
                  <td>
                    <StatusPill status={path.published ? "已发布" : "草稿"} />
                  </td>
                  <td>
                    <Link className={link} href={`/teacher/learning/${path.id}`}>
                      编辑
                    </Link>
                    <Link
                      className={`${link} ml-4`}
                      href={`/teacher/learning/${path.id}?preview=1`}
                    >
                      学生预览
                    </Link>
                  </td>
                </tr>
              ))}
              {!paths.loading && !paths.data?.items.length && (
                <Empty columns={6}>
                  暂无学习路径。点击“新建学习路径”组织课程内容。
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
                "类型",
                "标题",
                "关联路径 / 章节",
                "可见范围",
                "内容 / 操作",
              ]}
              min={760}
            >
              {resources.data?.items.map((r) => (
                <tr key={r.id}>
                  <td>{r.type}</td>
                  <td className="font-semibold">{r.title}</td>
                  <td>
                    {paths.data?.items.find((x) => x.id === r.pathId)?.title ??
                      "独立资料"}
                  </td>
                  <td>{r.scope === "school" ? "本校学生" : "维护教师"}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(r)}
                    >
                      查看 / 编辑
                    </Button>
                    {r.canEdit !== false && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() => {
                          if (
                            window.confirm("删除此资料？学习路径和题目保留。")
                          )
                            void action.run(async () => {
                              await productionApi(
                                `learning-resources/${r.id}`,
                                { method: "DELETE" },
                              );
                              resources.reload();
                              return "资料已删除。";
                            });
                        }}
                      >
                        删除
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!resources.loading && !resources.data?.items.length && (
                <Empty columns={5}>
                  暂无资料。添加说明或代码片段帮助学生复习。
                </Empty>
              )}
            </Table>
          </>
        )}
      </section>
      {create &&
        (tab === "学习路径" ? (
          <CreatePath
            onClose={() => setCreate(false)}
            onCreated={(id) => router.push(`/teacher/learning/${id}`)}
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
  return (
    <Modal title="新建学习路径" onClose={onClose}>
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
              },
            });
            onCreated(result.id);
          });
        }}
      >
        <Field label="名称">
          <input
            autoFocus
            name="title"
            required
            className={input}
            placeholder="输入自己的路径名称"
          />
        </Field>
        <Field label="简介">
          <textarea name="description" rows={3} className={area} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="课程标签">
            <select name="category" className={input}>
              {["Python", "ACSL", "CIE 9618", "Programming"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="预计学习时间（分钟）">
            <input
              name="minutes"
              type="number"
              min={0}
              max={10000}
              defaultValue={60}
              className={input}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          先创建草稿并添加章节，检查内容后发布给本校学生。
        </p>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            取消
          </Button>
          <Button disabled={action.busy}>创建并编辑</Button>
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
  return (
    <Modal title={initial ? "编辑学习资料" : "添加学习资料"} onClose={onClose}>
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
        <Field label="名称">
          <input
            name="title"
            required
            defaultValue={initial?.title}
            className={input}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型">
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
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="可见范围">
            <select
              name="scope"
              defaultValue={initial?.scope ?? "private"}
              className={input}
            >
              <option value="private">维护教师</option>
              <option value="school">本校学生</option>
            </select>
          </Field>
        </div>
        <Field label="关联路径">
          <select
            name="pathId"
            defaultValue={initial?.pathId ?? ""}
            className={input}
          >
            <option value="">独立资料</option>
            {paths.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="内容">
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
            取消
          </Button>
          <Button disabled={action.busy || initial?.canEdit === false}>
            保存资料
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TeacherLearningEditor({ id }: { id: string }) {
  const resource = useData<Path>(`learning-paths/${id}`);
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
    action = useAction();
  const chapter = chapters.find((x) => x.id === current) ?? chapters[0],
    selectedIndex = chapters.findIndex((x) => x.id === chapter?.id),
    dirty = JSON.stringify(chapters) !== JSON.stringify(path.chapters ?? []);
  useDirty(dirty);
  const update = <K extends keyof Chapter>(key: K, value: Chapter[K]) =>
    setChapters((xs) =>
      xs.map((x) => (x.id === chapter?.id ? { ...x, [key]: value } : x)),
    );
  const save = async () => {
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
  return (
    <>
      <Link
        href="/teacher/learning"
        className={`${link} mb-4 inline-block text-sm`}
      >
        ← 学习路径
      </Link>
      <PageHeader
        eyebrow="路径编辑"
        title={path.title}
        description="章节内容与题库题目通过引用连接，分组调整不会移除章节中的显式引用。"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPreview(true)}>
              <Eye size={15} />
              学生预览
            </Button>
            <Button
              disabled={action.busy || !path.canEdit}
              onClick={() =>
                void action.run(async () => {
                  await save();
                  return "学习路径章节已保存。";
                })
              }
            >
              保存草稿
            </Button>
            <Button
              variant="secondary"
              disabled={action.busy || !path.canEdit || path.published}
              onClick={() => setPublish(true)}
            >
              {path.published ? "已发布" : "发布"}
            </Button>
          </div>
        }
      />
      <Feedback action={action} />
      <div className="mt-4 grid items-center gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[180px_1fr]"><LearningCover coverKey={path.coverKey}/><div><p className="font-semibold">{courseDifficulties[path.difficulty??"beginner"]} · {chapters.length} 章</p><p className="mt-2 text-sm text-muted-foreground">{path.estimatedMinutes??30} 分钟 · 阅读与练习进度独立统计</p><Button variant="secondary" size="sm" className="mt-3" disabled={!path.canEdit} onClick={()=>setProgressOpen(true)}>查看学生进度总览</Button></div></div>
      {progressOpen&&<LearningProgressDialog id={path.id} onClose={()=>setProgressOpen(false)}/>}
      {path.canEdit&&path.category.includes("Python")&&<PythonPracticePanel id={path.id} bundle={path.practiceBundle??[]} disabled={dirty||action.busy} onRefreshStatus={async()=>{const fresh=await productionApi<Path>(`learning-paths/${path.id}`);setPath(current=>({...current,practiceBundle:fresh.practiceBundle}));}} onUpdated={async()=>{const fresh=await productionApi<Path>(`learning-paths/${path.id}`);setPath(fresh);setChapters(fresh.chapters??[]);}}/>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Button size="sm" variant="secondary" onClick={()=>{const doc:LearningDocument={format:"codemaster-learning-path",version:1,title:path.title,description:path.description,category:path.category,estimatedMinutes:path.estimatedMinutes??30,difficulty:path.difficulty??"beginner",coverKey:path.coverKey??"general",chapters:chapters.map(c=>({title:c.title,content:c.content,objective:c.objective??"",checkpoint:c.checkpoint??"",checkpointAnswer:c.checkpointAnswer??"",problemIds:c.problems.map(p=>p.problemId)}))};void action.run(async()=>{downloadLearningMarkdown(doc);return "已导出当前编辑内容（包括未保存修改）。";});}}>导出 Markdown</Button>
        <Button size="sm" variant="secondary" onClick={() => setMetadata(true)}>
          路径资料
        </Button>
        {dirty && <span className="text-warning">有未保存修改</span>}
      </div>
      <div className="mt-5 grid grid-cols-[260px_minmax(0,1fr)] gap-5 max-md:grid-cols-1">
        <aside className={`${panel} self-start md:sticky md:top-5`}>
          <div className="flex justify-between border-b border-border p-3">
            <b>章节</b>
            <Button
              size="sm"
              disabled={!path.canEdit}
              onClick={() => {
                const id = `new-${crypto.randomUUID()}`;
                setChapters((x) => [
                  ...x,
                  {
                    id,
                    title: "新章节",
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
              新增
            </Button>
          </div>
          <div className="max-h-[60dvh] overflow-y-auto">{chapters.map((x, i) => (
            <button
              key={x.id}
              onClick={() => setCurrent(x.id)}
              className={`flex w-full items-center justify-between border-b border-border px-3 py-3 text-left text-sm ${x.id === chapter?.id ? "bg-accent font-semibold text-primary" : ""}`}
            >
              <span>
                {i + 1}. {x.title}
              </span>
              <span>{x.problems.length} 题</span>
            </button>
          ))}
          </div>
          {!chapters.length && (
            <p className="p-4 text-sm text-muted-foreground">
              暂无章节，点击“新增”开始编写。
            </p>
          )}
        </aside>
        {chapter && (
          <section className={`${panel} p-5`}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="章节名称"
                value={chapter.title}
                onChange={(e) => update("title", e.target.value)}
                className={`${input} min-w-48 flex-1 font-bold`}
                disabled={!path.canEdit}
              />
              <Button
                size="icon"
                variant="secondary"
                title="章节上移"
                disabled={selectedIndex === 0 || !path.canEdit}
                onClick={() => setChapters(move(chapters, selectedIndex, -1))}
              >
                <ArrowUp size={15} />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                title="章节下移"
                disabled={
                  selectedIndex === chapters.length - 1 || !path.canEdit
                }
                onClick={() => setChapters(move(chapters, selectedIndex, 1))}
              >
                <ArrowDown size={15} />
              </Button>
              <Button
                variant="ghost"
                disabled={action.busy || !path.canEdit}
                onClick={() => {
                  if (window.confirm("从本路径移除此章节？题库题目保留。"))
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
                      return "章节已移除，题库题目保留。";
                    });
                }}
              >
                <Trash2 size={15} />
                移除章节
              </Button>
            </div>
            <div className="mt-5 grid gap-4">
              <Field label="学习目标">
                <textarea
                  value={chapter.objective ?? ""}
                  onChange={(e) => update("objective", e.target.value)}
                  rows={2}
                  className={area}
                />
              </Field>
              <Field label="正文 · Markdown 讲解与示例">
                <textarea
                  value={chapter.content}
                  onChange={(e) => update("content", e.target.value)}
                  rows={12}
                  className={area}
                />
              </Field>
              <section className="border border-border">
                <div className="flex justify-between gap-3 bg-surface-subtle p-3">
                  <div>
                    <b>练习引用</b>
                    <p className="text-xs text-muted-foreground">
                      从题库与分组选择；只存引用，不复制题面与测试。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={!path.canEdit}
                    onClick={() => setPicker(true)}
                  >
                    <Plus size={14} />
                    添加练习
                  </Button>
                </div>
                {chapter.problems.map((p, i) => (
                  <div
                    key={p.problemId}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-sm"
                  >
                    <Link
                      href={`/teacher/problems/${p.problemId}/edit`}
                      className={link}
                    >
                      {p.title}
                    </Link>
                    <span className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="练习上移"
                        disabled={i === 0}
                        onClick={() =>
                          update("problems", move(chapter.problems, i, -1))
                        }
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="练习下移"
                        disabled={i === chapter.problems.length - 1}
                        onClick={() =>
                          update("problems", move(chapter.problems, i, 1))
                        }
                      >
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update(
                            "problems",
                            chapter.problems.filter(
                              (x) => x.problemId !== p.problemId,
                            ),
                          )
                        }
                      >
                        移除引用
                      </Button>
                    </span>
                  </div>
                ))}
              </section>
              <Field label="检查点 · 独立练习">
                <textarea
                  value={chapter.checkpoint ?? ""}
                  onChange={(e) => update("checkpoint", e.target.value)}
                  rows={3}
                  className={area}
                />
              </Field>
              <Field label="检查点参考答案">
                <textarea
                  value={chapter.checkpointAnswer ?? ""}
                  onChange={(e) => update("checkpointAnswer", e.target.value)}
                  rows={3}
                  className={area}
                />
              </Field>
            </div>
          </section>
        )}
      </div>
      {picker && chapter && (
        <ProblemPicker
          selected={chapter.problems.map((x) => x.problemId)}
          onClose={() => setPicker(false)}
          onAdd={(items) => {
            update("problems", [
              ...chapter.problems,
              ...items.map((x) => ({
                problemId: x.id,
                title: x.publishedTitle ?? x.title,
                versionId: x.publishedVersionId ?? x.versionId ?? "",
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
              <b>学生预览 · {chapter?.title}</b>
              <p className="text-xs text-muted-foreground">当前编辑内容</p>
            </div>
            <Button variant="secondary" onClick={() => setPreview(false)}>
              ← 返回原编辑位置
            </Button>
          </div>
          <article className="mx-auto max-w-3xl p-8">
            <h1 className="text-2xl font-bold">{chapter?.title}</h1>
            <p className="mt-4 text-sm text-primary">{chapter?.objective}</p>
            <div className="mt-6"><LessonContent content={chapter?.content??""}/></div>
            {chapter?.checkpoint && (
              <section className="mt-6 border border-primary/30 bg-info-soft p-5">
                <h2 className="font-bold">Checkpoint</h2>
                <div className="mt-3"><LessonContent content={chapter.checkpoint}/></div>
                <details className="mt-4 text-sm">
                  <summary>查看参考答案</summary>
                  <div className="mt-3"><LessonContent content={chapter.checkpointAnswer??""}/></div>
                </details>
              </section>
            )}
            <h2 className="mt-6 font-bold">相关练习</h2>
            {chapter?.problems.map((x) => (
              <p className="mt-3 text-primary" key={x.problemId}>
                {x.title}
              </p>
            ))}
          </article>
        </div>
      )}
      {metadata && (
        <Modal title="路径资料" onClose={() => setMetadata(false)}>
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
            <Field label="名称">
              <input
                name="title"
                required
                defaultValue={path.title}
                className={input}
              />
            </Field>
            <Field label="课程标签">
              <input
                name="category"
                required
                defaultValue={path.category}
                className={input}
              />
            </Field>
            <Field label="课程难度"><select name="difficulty" defaultValue={path.difficulty??"beginner"} className={input}>{Object.entries(courseDifficulties).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="课程封面"><select name="coverKey" defaultValue={path.coverKey??"general"} className={input}>{Object.entries(courseCovers).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="简介">
              <textarea
                name="description"
                defaultValue={path.description}
                className={area}
              />
            </Field>
            <Field label="预计学习时间（分钟）">
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
            <Button disabled={action.busy}>保存路径资料</Button>
          </form>
        </Modal>
      )}
      {publish && (
        <Modal title="确认发布学习路径" onClose={() => setPublish(false)}>
          <p className="text-sm">
            发布后，本校学生可阅读章节并练习关联的已发布题目。
          </p>
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPublish(false)}>
              取消
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
                  return "学习路径已发布。";
                })
              }
            >
              确认发布
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
