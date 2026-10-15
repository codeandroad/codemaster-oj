"use client";
import {useRef,useState} from "react";
import {FileUp} from "lucide-react";
import {Button} from "@/components/ui/button";
import type {ProblemCase} from "@/lib/production-api";
import {area,Drawer,Feedback,Field,input,Modal,Table,useAction} from "./shared";
import {validateFunctionCase} from "./test-validation";
import {useLocale} from "@/components/locale-context";
export interface EditorCase extends ProblemCase {name?:string;enabled?:boolean}
export function TestDrawer({
  mode,
  kind,
  initial,
  onClose,
  onSave,
}: {
  mode: string;
  kind: string;
  initial: EditorCase | null;
  onClose: () => void;
  onSave: (value: EditorCase) => void;
}) {
  const {locale}=useLocale();
  const tr=(zh:string,en:string)=>locale==="zh"?zh:en;
  const [value, setValue] = useState<EditorCase>(
      initial ?? {
        name: kind === "samples" ? tr("新样例", "New sample") : tr("新正式测试", "New formal test"),
        input: "",
        expected: "",
        enabled: true,
      },
    ),
    [format, setFormat] = useState("文本输入"),
    action = useAction();
  return (
    <Drawer
      title={`${initial ? tr("编辑", "Edit") : tr("添加", "Add")} ${kind === "samples" ? tr("公开样例", "public sample") : tr("正式测试", "formal test")}`}
      onClose={onClose}
    >
      <div className="space-y-5">
        <Field label={tr("用例名称", "Case name")}>
          <input
            className={input}
            value={value.name ?? ""}
            onChange={(e) => setValue((x) => ({ ...x, name: e.target.value }))}
          />
        </Field>
        {mode === "stdio" && (
          <div className="flex gap-2">
            {["文本输入", "使用文件"].map((x) => (
              <Button
                key={x}
                variant={format === x ? "primary" : "secondary"}
                onClick={() => setFormat(x)}
              >
                {tr(x,x==="文本输入"?"Text input":"Use files")}
              </Button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          {(["input", "expected"] as const).map((key) => (
            <Field
              key={key}
              label={
                mode === "function"
                  ? key === "input"
                    ? tr("参数（JSON 数组或 args / kwargs 对象）", "Parameters (JSON array or args / kwargs object)")
                    : tr("期望返回值（JSON）", "Expected return (JSON)")
                  : key === "input"
                    ? tr("输入文本（允许为空）", "Input text (may be empty)")
                    : tr("期望输出文本（允许为空）", "Expected output (may be empty)")
              }
            >
              {format === "使用文件" && mode === "stdio" && (
                <input
                  aria-label={key === "input" ? tr("替换输入文件", "Replace input file") : tr("替换输出文件", "Replace output file")}
                  type="file"
                  className="mb-2 w-full text-xs"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void action.run(async () => {
                        if (file.size > 128 * 1024)
                          throw new Error(tr("单个测试文件不能超过 128 KB。", "Each test file must be 128 KB or smaller."));
                        const content = await file.text();
                        setValue((x) => ({ ...x, [key]: content }));
                        return `${file.name} ${tr("已读取，可继续替换。", "read; you can replace it again.")}`;
                      });
                  }}
                />
              )}
              <textarea
                rows={10}
                className={`${area} font-mono`}
                value={value[key]}
                onChange={(e) =>
                  setValue((x) => ({ ...x, [key]: e.target.value }))
                }
              />
            </Field>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.enabled !== false}
            onChange={(e) =>
              setValue((x) => ({ ...x, enabled: e.target.checked }))
            }
          />
          {tr("启用此测试", "Enable this test")}
        </label>
        <Feedback action={action} />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            {tr("取消", "Cancel")}
          </Button>
          <Button
            onClick={() =>
              void action.run(async () => {
                if (mode === "function" && value.enabled !== false) validateFunctionCase(value.input,value.expected);
                onSave(value);
              })
            }
          >
            {tr("保存到草稿", "Save to draft")}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
export function BatchTests({
  mode,
  currentCount,
  onClose,
  onApply,
}: {
  mode: string;
  currentCount: number;
  onClose: () => void;
  onApply: (rows: EditorCase[], replace: boolean) => void;
}) {
  const {locale}=useLocale();
  const tr=(zh:string,en:string)=>locale==="zh"?zh:en;
  const [step, setStep] = useState(1),
    [rows, setRows] = useState<EditorCase[]>([]),
    [replace, setReplace] = useState(false),
    [names, setNames] = useState<string[]>([]),
    action = useAction(),
    fileRef = useRef<HTMLInputElement>(null);
  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setRows([]);setStep(1);
    const selected = Array.from(files);
    if (selected.some((f) => f.size > 128 * 1024) || selected.length > 100)
      throw new Error(tr("最多 100 个文件，每个文件不超过 128 KB。", "Up to 100 files, each no larger than 128 KB."));
    setNames(selected.map((x) => x.name));
    if (
      mode === "function" ||
      (selected.length === 1 && selected[0]?.name.endsWith(".json"))
    ) {
      const parsed: unknown = JSON.parse(await selected[0]!.text());
      if (
        !Array.isArray(parsed) || parsed.length===0 || parsed.length>100 ||
        parsed.some(
          (x) =>
            !x || typeof x.input !== "string" || typeof x.expected !== "string",
        )
      )
        throw new Error(tr("JSON 须为 1–100 项包含字符串 input 与 expected 的测试数组。", "JSON must be an array of 1–100 tests with string input and expected fields."));
      if(mode==="function")for(const row of parsed)validateFunctionCase(row.input,row.expected);
      setRows(
        parsed.map((x, i) => ({
          ...x,
          name: x.name ?? `${tr("测试", "Test")} ${i + 1}`,
          enabled: true,
        })),
      );
    } else {
      const result: EditorCase[] = [];
      for (const f of selected.filter((x) => x.name.endsWith(".in"))) {
        const prefix = f.name.slice(0, -3),
          output = selected.find((x) => x.name === `${prefix}.out`);
        if (!output) throw new Error(`${f.name} ${tr("缺少对应", "is missing matching")} ${prefix}.out${locale==="zh"?"。":"."}`);
        result.push({
          name: prefix,
          input: await f.text(),
          expected: await output.text(),
          enabled: true,
        });
      }
      if (!result.length || result.length * 2 !== selected.length)
        throw new Error(tr("标准输入输出测试须选择完整同名 .in / .out 配对。", "Standard I/O tests require complete matching .in / .out pairs."));
      setRows(result);
    }
    setStep(2);
    return tr("文件已读取，请检查测试配对。", "Files read. Check test pairing.");
  };
  return (
    <Modal title={tr("批量导入测试", "Bulk import tests")} onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {["1 选择测试文件", "2 配对 / 参数映射预览", "3 确认应用"].map(
          (label, i) => (
            <div
              key={label}
              className={`border p-3 text-center font-semibold ${step === i + 1 ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"}`}
            >
              {tr(label, ["1 Choose test files", "2 Review pairs / parameters", "3 Confirm import"][i] ?? label)}
            </div>
          ),
        )}
      </div>
      {step === 1 && (
        <div
          className="mt-5 border border-dashed border-border-strong p-8 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void action.run(() => read(e.dataTransfer.files));
          }}
        >
          <FileUp className="mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm">
            {tr("选择", "Choose")}{" "}
            {mode === "function"
              ? tr("JSON 测试数组", "JSON test array")
              : tr("成对 .in / .out 文件或 JSON 测试数组", "paired .in / .out files or a JSON test array")}
          </p>
          <Button className="mt-4" onClick={() => fileRef.current?.click()}>
            {tr("选择文件", "Choose files")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={mode === "function" ? ".json" : ".json,.in,.out"}
            className="hidden"
            onChange={(e) => void action.run(() => read(e.target.files))}
          />
        </div>
      )}
      {step === 2 && (
        <div className="mt-5">
          <p className="text-xs text-muted-foreground">{names.join("、")}</p>
          <Table min={400} headers={[tr("测试", "Test"), tr("输入 / 参数", "Input / parameters"), tr("期望结果", "Expected result")]}>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td>
                  <pre className="max-w-48 truncate text-xs">{r.input}</pre>
                </td>
                <td>
                  <pre className="max-w-48 truncate text-xs">{r.expected}</pre>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {step === 3 && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            className={`border p-4 text-left ${!replace ? "border-primary bg-accent" : "border-border"}`}
            onClick={() => setReplace(false)}
          >
            <b>{tr("追加测试", "Append tests")}</b>
            <p className="mt-1 text-xs text-muted-foreground">
              {tr("保留当前", "Keep current")} {currentCount} {tr("个正式测试。", "formal tests.")}
            </p>
          </button>
          <button
            className={`border p-4 text-left ${replace ? "border-destructive bg-destructive/5" : "border-border"}`}
            onClick={() => setReplace(true)}
          >
            <b>{tr("替换全部正式测试", "Replace all formal tests")}</b>
            <p className="mt-1 text-xs text-muted-foreground">
              {tr("替换当前草稿；已发布版本保留。", "Replace only the current draft; published versions remain.")}
            </p>
          </button>
        </div>
      )}
      <Feedback action={action} />
      <div className="mt-6 flex justify-between border-t border-border pt-4">
        <Button
          variant="secondary"
          disabled={step === 1}
          onClick={() => setStep((x) => x - 1)}
        >
          {tr("上一步", "Back")}
        </Button>
        {step < 3 ? (
          <Button
            disabled={!rows.length || action.busy}
            onClick={() => setStep((x) => x + 1)}
          >
            {tr("下一步", "Next")}
          </Button>
        ) : (
          <Button
            variant={replace ? "danger" : "primary"}
            onClick={() => {
              if (
                !replace ||
                window.confirm(`${tr("确认替换当前草稿的", "Replace")} ${currentCount} ${tr("个测试？", "tests in the current draft?")}`)
              )
                onApply(rows, replace);
            }}
          >
            {replace ? tr("确认替换", "Replace") : tr("确认追加", "Append")} {rows.length} {tr("个测试", "tests")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
