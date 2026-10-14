"use client";

import { AppLink as Link } from "@/components/navigation";
import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Pencil, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-chrome";
import {
  productionApi,
  productionId,
  type ProductionProblem,
} from "@/lib/production-api";
import { Bank, Group, ManageGroups } from "./problem-banks";
import {
  area,
  date,
  Drawer,
  Empty,
  Feedback,
  Field,
  input,
  link,
  panel,
  State,
  Table,
  Tabs,
  useAction,
  useData,
} from "./shared";

import {
  readProblemImport,
  type ImportCandidate as Candidate,
} from "./problem-package";
interface ImportResult {
  items: {
    line: number;
    status: string;
    problem?: ProductionProblem;
    message?: string;
  }[];
  summary: { created: number; failed: number; total: number };
}
interface ImportRecord {
  id: string;
  bankId: string;
  fileName: string;
  createdAt: string;
  summary: { created: number; failed: number; total: number };
}
const steps = ["1 选择文件与去向", "2 预览题目", "3 确认导入"];
export function TeacherProblemImports() {
  const search = useSearchParams(),
    banks = useData<{ items: Bank[] }>("problem-banks"),
    groups = useData<{ items: Group[] }>("problem-groups"),
    problems = useData<{ items: ProductionProblem[] }>("problems"),
    records = useData<{ items: ImportRecord[] }>("problems/import"),
    fileRef = useRef<HTMLInputElement>(null),
    [section, setSection] = useState("题目导入"),
    [step, setStep] = useState(1),
    [destination, setDestination] = useState(
      search.get("bankId") ? "已有题库" : "新建题库",
    ),
    [bankId, setBankId] = useState(search.get("bankId") ?? ""),
    [bankName, setBankName] = useState(""),
    [description, setDescription] = useState(""),
    [groupId, setGroupId] = useState(""),
    [newGroup, setNewGroup] = useState(""),
    [rows, setRows] = useState<Candidate[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [filename, setFilename] = useState(""),
    [files, setFiles] = useState<string[]>([]),
    [editing, setEditing] = useState<number | null>(null),
    [result, setResult] = useState<ImportResult | null>(null),
    [key, setKey] = useState(productionId),
    [targetBank, setTargetBank] = useState(""),
    [manage, setManage] = useState<string[] | null>(null),
    [testProblem, setTestProblem] = useState(""),
    [query, setQuery] = useState(""),
    action = useAction();
  const targetName =
      destination === "新建题库"
        ? bankName.trim() || "未命名新题库"
        : (banks.data?.items.find((x) => x.id === bankId)?.name ??
          "未选择题库"),
    editableBanks =
      banks.data?.items.filter(
        (x) =>
          x.canContribute ||
          x.canEdit ||
          ["owner", "edit"].includes(x.permission),
      ) ?? [],
    created =
      result?.items.filter((x) => x.problem).map((x) => x.problem!) ?? [];
  const read = async (file: File | undefined) => {
    if (!file) return;
    const { rows: parsed, files: parsedFiles } = await readProblemImport(file);
    setFiles(parsedFiles);
    setRows(parsed);
    setSelected(parsed.map((_, i) => i));
    setFilename(file.name);
    setStep(1);
    setResult(null);
    setKey(productionId());
    setTargetBank("");
    return `${file.name} 已读取，共 ${parsed.length} 道候选题目。`;
  };
  const confirm = async () => {
    let actualBank = targetBank || bankId;
    if (destination === "新建题库" && !targetBank) {
      const created = await productionApi<Bank>("problem-banks", {
        method: "POST",
        body: {
          name: bankName,
          description,
          course: "Python",
          visibility: "private",
        },
      });
      actualBank = created.id;
      setTargetBank(created.id);
      banks.reload();
    }
    if (!actualBank) throw new Error("请选择目标题库。");
    const receipt = await productionApi<ImportResult>("problems/import", {
      method: "POST",
      body: {
        bankId: actualBank,
        idempotencyKey: key,
        filename,
        rows: selected.map((i) => ({ ...rows[i], saveDraft: true })),
      },
    });
    setTargetBank(actualBank);
    setResult(receipt);
    records.reload();
    const ids = receipt.items.flatMap((x) => (x.problem ? [x.problem.id] : []));
    if (ids.length && newGroup.trim())
      await productionApi("problem-groups", {
        method: "POST",
        body: { bankId: actualBank, name: newGroup.trim(), problemIds: ids },
      });
    else if (ids.length && groupId) {
      const g = groups.data?.items.find((x) => x.id === groupId);
      if (g)
        await productionApi(`problem-groups/${groupId}`, {
          method: "PATCH",
          body: { problemIds: [...new Set([...g.problemIds, ...ids])] },
        });
    }
    groups.reload();
    return `已保存 ${receipt.summary.created} 道草稿，${receipt.summary.failed} 道失败。`;
  };
  return (
    <>
      <PageHeader
        eyebrow="Import Center"
        title="导入中心"
        description="题目与名单共用分步骤导入；测试补充回到统一题目编辑器。"
      />
      <div className="mt-5 flex gap-2">
        <Link className={buttonVariants()} href="/teacher/imports?kind=problems">
          题目 / 测试
        </Link>
        <Link
          className={buttonVariants({ variant: "secondary" })}
          href="/teacher/imports?kind=members"
        >
          班级成员
        </Link>
      </div>
      <Tabs
        value={section}
        onChange={setSection}
        items={["题目导入", "补充测试数据", "导入记录"]}
      />
      <Feedback action={action} />
      <State resource={banks} />
      {section === "题目导入" && (
        <section className={`${panel} mt-4 p-5`}>
          {!result ? (
            <>
              <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                {steps.map((label, i) => (
                  <div
                    key={label}
                    className={`border px-3 py-3 text-center text-sm font-semibold ${step === i + 1 ? "border-primary bg-accent text-primary" : "border-border bg-surface-subtle text-muted-foreground"}`}
                  >
                    {label}
                  </div>
                ))}
              </div>
              {step === 1 && (
                <div className="mt-5 space-y-5">
                  <div
                    className="border border-dashed border-border-strong bg-surface-subtle p-8 text-center"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void action.run(() => read(e.dataTransfer.files[0]));
                    }}
                  >
                    <Upload
                      className="mx-auto text-muted-foreground"
                      size={25}
                    />
                    <p className="mt-3 font-semibold">
                      拖放题目 JSON / ZIP 文件到这里
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      在浏览器内解析，检查并确认后保存为教师草稿
                    </p>
                    <Button
                      className="mt-4"
                      onClick={() => fileRef.current?.click()}
                    >
                      选择文件
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".json,.zip,application/json,application/zip"
                      className="hidden"
                      onChange={(e) =>
                        void action.run(() => read(e.target.files?.[0]))
                      }
                    />
                    {filename && (
                      <p className="mt-4 text-sm font-semibold">
                        {filename} · {rows.length} 道候选
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-semibold">导入去向</span>
                    <div className="mt-2 flex gap-2">
                      {["新建题库", "已有题库"].map((x) => (
                        <Button
                          key={x}
                          variant={destination === x ? "primary" : "secondary"}
                          onClick={() => {
                            setDestination(x);
                            setKey(productionId());
                          }}
                        >
                          {x}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {destination === "新建题库" ? (
                    <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                      <Field label="题库名称">
                        <input
                          className={input}
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          placeholder="例如 ACSL Contest 1"
                        />
                      </Field>
                      <Field label="简介（可选）">
                        <input
                          className={input}
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                      </Field>
                    </div>
                  ) : (
                    <Field label="选择已有题库">
                      <select
                        className={input}
                        value={bankId}
                        onChange={(e) => {
                          setBankId(e.target.value);
                          setGroupId("");
                          setKey(productionId());
                        }}
                      >
                        <option value="">请选择可编辑题库</option>
                        {editableBanks.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                    <Field label="目标分组">
                      <select
                        value={groupId}
                        onChange={(e) => setGroupId(e.target.value)}
                        className={input}
                        disabled={destination === "新建题库"}
                      >
                        <option value="">未分组</option>
                        {groups.data?.items
                          .filter((g) => g.bankId === bankId && g.canEdit)
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="新建分组（可选）">
                      <input
                        className={input}
                        value={newGroup}
                        onChange={(e) => setNewGroup(e.target.value)}
                      />
                    </Field>
                  </div>
                  <details className="border border-border">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                      查看格式、模板与来源说明
                    </summary>
                    <div className="space-y-3 border-t border-border p-4 text-sm text-muted-foreground">
                      <p>
                        JSON 支持题目对象数组和 codemaster-python-practice v1 配套题目包。每题含 title、mode（stdio /
                        function）、statement、starterCode、samples、tests、referenceCode、timeLimitMs、memoryLimitMb；可选
                        starterCodes（python/cpp/javascript）和 referenceLanguage。函数题另含 functionName。样例与测试含
                        input、expected。测试字符串可以为空。
                      </p>
                      <p>
                        ZIP 支持 problem.md + tests/或 testdata/中的 .in/.out
                        配对，也支持 JSON 清单；配置与 pid
                        可省略。标题取题面首个一级标题。公开样例从
                        samples/文件或题面样例代码块读取，与正式测试分开；一个文件对只算一个测试点。
                      </p>
                      <p>
                        可选 config.json/config.yaml/config.yml
                        支持标题、时限、内存、接口、样例/测试文件引用与
                        source/owner 元信息。reference.py/.cpp/.js 或 solution.py/.cpp/.js
                        提供相应语言的参考解，starter.py/.cpp/.js
                        提供模板；也可在配置中明确指定 referenceLanguage 和 starterCodes。题包解析时不执行代码。缺少参考解或未配对测试会逐题提示，仍可保存待完善草稿，实际验证通过后才可发布。
                      </p>
                      <p>
                        ZIP 最多 512 项，解压合计 2
                        MB；拒绝路径穿越、重复路径、符号链接、加密文件与 CRC
                        不一致。
                      </p>
                      <p>
                        A+B 若题面规定读取至 EOF，0 0 也必须计算并输出
                        0；这里不会替换为终止条件。
                      </p>
                    </div>
                  </details>
                  {files.length > 0 && (
                    <details className="border border-border">
                      <summary className="cursor-pointer p-3 text-sm font-semibold">
                        文件结构 · {files.length} 项
                      </summary>
                      <ul className="max-h-48 overflow-auto px-4 pb-4 font-mono text-xs">
                        {files.map((x) => (
                          <li className="py-1" key={x}>
                            {x}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              {step === 2 && (
                <div className="mt-5">
                  <div className="flex justify-between">
                    <div>
                      <h2 className="text-lg font-bold">预览题目</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {filename} → {targetName} · 已选 {selected.length} 道
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => setSelected(rows.map((_, i) => i))}
                    >
                      全选候选
                    </Button>
                  </div>
                  <div className="mt-4 border border-border">
                    <Table
                      headers={[
                        "选择",
                        "标题",
                        "接口",
                        "样例",
                        "正式测试",
                        "处理方式",
                        "操作",
                      ]}
                    >
                      {rows.map((row, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              aria-label={`选择候选 ${String(row.title ?? i + 1)}`}
                              type="checkbox"
                              checked={selected.includes(i)}
                              onChange={(e) => {
                                setSelected((x) =>
                                  e.target.checked
                                    ? [...x, i]
                                    : x.filter((v) => v !== i),
                                );
                                setKey(productionId());
                              }}
                            />
                          </td>
                          <td className="font-semibold">
                            {String(row.title ?? "缺少标题")}
                          </td>
                          <td>
                            {row.mode === "function"
                              ? "Function"
                              : "Standard I/O"}
                          </td>
                          <td>{row.samples?.length ?? 0}</td>
                          <td>{row.tests?.length ?? 0}</td>
                          <td className="text-xs text-muted-foreground">
                            新增草稿 ·{" "}
                            {row._importWarnings?.length
                              ? "待完善"
                              : row.statement &&
                                  row.referenceCode &&
                                  row.tests?.length
                                ? "待参考解验证"
                                : "待完善"}
                            {row._importWarnings?.map((warning) => (
                              <p key={warning} className="mt-1 text-warning">
                                {warning}
                              </p>
                            ))}
                          </td>
                          <td>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditing(i)}
                            >
                              <Pencil size={14} />
                              查看 / 编辑
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                </div>
              )}
              {step === 3 && (
                <div className="mt-5">
                  <h2 className="text-lg font-bold">确认导入</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    检查去向与题目数量后保存为教师草稿。
                  </p>
                  <dl className="mt-5 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                    {[
                      [
                        "处理方式",
                        destination === "新建题库"
                          ? "创建新题库并导入"
                          : "加入已有题库",
                      ],
                      ["目标题库", targetName],
                      [
                        "目标分组",
                        newGroup ||
                          groups.data?.items.find((x) => x.id === groupId)
                            ?.name ||
                          "未分组",
                      ],
                      ["已选择", `${selected.length} 道`],
                      ["拟新增", `${selected.length} 道`],
                      ["未选择", `${rows.length - selected.length} 道`],
                    ].map(([k, v]) => (
                      <div
                        className="border border-border bg-surface-subtle p-4"
                        key={k}
                      >
                        <dt className="text-xs text-muted-foreground">{k}</dt>
                        <dd className="mt-1 font-semibold">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 border border-border p-4 text-sm text-muted-foreground">
                    导入草稿与题目发布分别进行。成功行保留，失败行显示具体原因，可修正后重新导入。
                  </p>
                </div>
              )}
              <div className="mt-6 flex justify-between border-t border-border pt-4">
                <Button
                  variant="secondary"
                  disabled={step === 1 || action.busy}
                  onClick={() => setStep((x) => x - 1)}
                >
                  上一步
                </Button>
                {step < 3 ? (
                  <Button
                    disabled={
                      !rows.length ||
                      !selected.length ||
                      (destination === "新建题库" ? !bankName.trim() : !bankId)
                    }
                    onClick={() => setStep((x) => x + 1)}
                  >
                    下一步 →
                  </Button>
                ) : (
                  <Button
                    disabled={action.busy || !selected.length}
                    onClick={() => void action.run(confirm)}
                  >
                    {action.busy ? "正在导入…" : "确认导入草稿"}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-3 border border-success/30 bg-success-soft p-4">
                <CheckCircle2 className="mt-0.5 text-success" />
                <div>
                  <h2 className="font-bold">
                    已保存 {result.summary.created} 道草稿题目
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    目标题库：{targetName} · {result.summary.failed} 道失败 · 0
                    道自动发布
                  </p>
                </div>
              </div>
              <div className="mt-5 border border-border">
                <Table
                  headers={[
                    "题目 / 行",
                    "公开样例",
                    "正式测试",
                    "状态",
                    "操作",
                  ]}
                >
                  {result.items.map((row) => (
                    <tr key={row.line}>
                      <td className="font-semibold">
                        {row.problem?.title ?? `第 ${row.line} 行`}
                      </td>
                      <td>{row.problem?.samples.length ?? "—"}</td>
                      <td>{row.problem?.tests?.length ?? "—"}</td>
                      <td>
                        {row.problem
                          ? "教师草稿 · 查看验证结果"
                          : (row.message ?? "导入失败")}
                      </td>
                      <td>
                        {row.problem && (
                          <>
                            <Link
                              href={`/teacher/problems/${row.problem.id}/edit?returnTo=${encodeURIComponent(`/teacher/problems/banks/${targetBank}`)}`}
                              className={link}
                            >
                              编辑
                            </Link>
                            <button
                              className={`${link} ml-3`}
                              onClick={() => setManage([row.problem!.id])}
                            >
                              整理分组
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={!created.length}
                  onClick={() => setManage(created.map((x) => x.id))}
                >
                  整理分组
                </Button>
                <Link
                  className={buttonVariants()}
                  href={`/teacher/problems/banks/${targetBank}`}
                >
                  打开题库
                </Link>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setResult(null);
                    setRows([]);
                    setSelected([]);
                    setFilename("");
                    setStep(1);
                    setKey(productionId());
                    setTargetBank("");
                  }}
                >
                  继续导入
                </Button>
              </div>
            </>
          )}
        </section>
      )}
      {section === "补充测试数据" && (
        <section className={`${panel} mt-4 p-5`}>
          <h2 className="text-lg font-bold">补充测试数据</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            选择目标题目，进入该题草稿的测试数据页，不创建另一道题。
          </p>
          <div className="mt-5 space-y-3">
            <input
              aria-label="搜索目标题目"
              className={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索题目标题"
            />
            <select
              aria-label="目标题目"
              value={testProblem}
              onChange={(e) => setTestProblem(e.target.value)}
              className={input}
            >
              <option value="">请选择可编辑题目</option>
              {problems.data?.items
                .filter(
                  (x) =>
                    x.canEdit !== false &&
                    x.title.toLowerCase().includes(query.toLowerCase()),
                )
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
            </select>
            {testProblem && (
              <Link
                href={`/teacher/problems/${testProblem}/edit?tab=tests&returnTo=${encodeURIComponent("/teacher/imports")}`}
                className={buttonVariants()}
              >
                编辑测试
              </Link>
            )}
          </div>
        </section>
      )}
      {section === "导入记录" && (
        <section className={`${panel} mt-4`}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-bold">导入记录</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              时间、来源文件、目标题库与本批结果。
            </p>
          </div>
          <State resource={records} />
          <Table headers={["时间", "来源文件", "目标题库", "题数", "结果"]}>
            {records.data?.items.map((r) => (
              <tr key={r.id}>
                <td>{date(r.createdAt)}</td>
                <td>{r.fileName || "JSON 清单"}</td>
                <td>
                  {banks.data?.items.find((x) => x.id === r.bankId)?.name ??
                    r.bankId.slice(0, 8)}
                </td>
                <td>{r.summary.total}</td>
                <td>
                  成功 {r.summary.created} · 失败 {r.summary.failed}
                </td>
              </tr>
            ))}
            {!records.loading && !records.data?.items.length && (
              <Empty columns={5}>暂无导入记录。</Empty>
            )}
          </Table>
        </section>
      )}
      {editing !== null && rows[editing] && (
        <CandidateEditor
          initial={rows[editing]!}
          targetName={targetName}
          onClose={() => setEditing(null)}
          onSave={(value) => {
            setRows((x) => x.map((r, i) => (i === editing ? value : r)));
            setKey(productionId());
            setEditing(null);
          }}
        />
      )}
      {manage && targetBank && (
        <ManageGroups
          bankId={targetBank}
          problemIds={manage}
          onClose={() => setManage(null)}
          onSaved={() => {
            setManage(null);
            groups.reload();
          }}
        />
      )}
    </>
  );
}
function CandidateEditor({
  initial,
  targetName,
  onClose,
  onSave,
}: {
  initial: Candidate;
  targetName: string;
  onClose: () => void;
  onSave: (value: Candidate) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Drawer title="待导入候选" onClose={onClose}>
      <p className="text-xs text-muted-foreground">{targetName} / 导入草稿</p>
      {value._importWarnings?.map((warning) => (
        <p key={warning} className="mt-2 text-sm text-warning">
          {warning}
        </p>
      ))}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <Field label="题目标题">
          <input
            value={String(value.title ?? "")}
            onChange={(e) => setValue((x) => ({ ...x, title: e.target.value }))}
            className={input}
          />
        </Field>
        <Field label="接口">
          <select
            value={value.mode ?? "stdio"}
            onChange={(e) =>
              setValue((x) => ({
                ...x,
                mode: e.target.value as "stdio" | "function",
              }))
            }
            className={input}
          >
            <option value="stdio">Standard I/O</option>
            <option value="function">Function</option>
          </select>
        </Field>
      </div>
      <div className="mt-4">
        <Field label="题面">
          <textarea
            value={String(value.statement ?? "")}
            onChange={(e) =>
              setValue((x) => ({ ...x, statement: e.target.value }))
            }
            rows={9}
            className={area}
          />
        </Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="border border-border p-4">
          <b>公开样例 · {value.samples?.length ?? 0}</b>
          <pre className="mt-3 whitespace-pre-wrap rounded bg-code p-3 font-mono text-xs text-code-foreground">
            {value.samples?.[0]?.input}
            {"\n→ "}
            {value.samples?.[0]?.expected}
          </pre>
        </div>
        <div className="border border-border p-4">
          <b>正式测试 · {value.tests?.length ?? 0}</b>
          <p className="mt-3 text-sm text-muted-foreground">
            导入后使用统一编辑器逐条查看、修改测试与参考解。
          </p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button onClick={() => onSave(value)}>应用修改</Button>
      </div>
    </Drawer>
  );
}

/** Read bounded ZIP contents without executing entries or extracting paths to disk. */
