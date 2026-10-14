"use client";
import {useRef,useState} from "react";
import {FileUp} from "lucide-react";
import {Button} from "@/components/ui/button";
import type {ProblemCase} from "@/lib/production-api";
import {area,Drawer,Feedback,Field,input,Modal,Table,useAction} from "./shared";
import {validateFunctionCase} from "./test-validation";
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
  const [value, setValue] = useState<EditorCase>(
      initial ?? {
        name: kind === "samples" ? "New sample" : "New formal test",
        input: "",
        expected: "",
        enabled: true,
      },
    ),
    [format, setFormat] = useState("文本输入"),
    action = useAction();
  return (
    <Drawer
      title={`${initial ? "编辑" : "添加"}${kind === "samples" ? "公开样例" : "正式测试"}`}
      onClose={onClose}
    >
      <div className="space-y-5">
        <Field label="用例名称">
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
                {x}
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
                    ? "参数（JSON 数组或 args / kwargs 对象）"
                    : "期望返回值（JSON）"
                  : key === "input"
                    ? "输入文本（允许为空）"
                    : "期望输出文本（允许为空）"
              }
            >
              {format === "使用文件" && mode === "stdio" && (
                <input
                  aria-label={key === "input" ? "替换输入文件" : "替换输出文件"}
                  type="file"
                  className="mb-2 w-full text-xs"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void action.run(async () => {
                        if (file.size > 128 * 1024)
                          throw new Error("单个测试文件不能超过 128 KB。");
                        const content = await file.text();
                        setValue((x) => ({ ...x, [key]: content }));
                        return `${file.name} 已读取，可继续替换。`;
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
          启用此测试
        </label>
        <Feedback action={action} />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() =>
              void action.run(async () => {
                if (mode === "function" && value.enabled !== false) validateFunctionCase(value.input,value.expected);
                onSave(value);
              })
            }
          >
            保存到草稿
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
      throw new Error("最多 100 个文件，每个文件不超过 128 KB。");
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
        throw new Error("JSON 须为 1–100 项包含字符串 input 与 expected 的测试数组。");
      if(mode==="function")for(const row of parsed)validateFunctionCase(row.input,row.expected);
      setRows(
        parsed.map((x, i) => ({
          ...x,
          name: x.name ?? `Test ${i + 1}`,
          enabled: true,
        })),
      );
    } else {
      const result: EditorCase[] = [];
      for (const f of selected.filter((x) => x.name.endsWith(".in"))) {
        const prefix = f.name.slice(0, -3),
          output = selected.find((x) => x.name === `${prefix}.out`);
        if (!output) throw new Error(`${f.name} 缺少对应 ${prefix}.out。`);
        result.push({
          name: prefix,
          input: await f.text(),
          expected: await output.text(),
          enabled: true,
        });
      }
      if (!result.length || result.length * 2 !== selected.length)
        throw new Error("标准输入输出测试须选择完整同名 .in / .out 配对。");
      setRows(result);
    }
    setStep(2);
    return "文件已读取，请检查测试配对。";
  };
  return (
    <Modal title="批量导入测试" onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {["1 选择测试文件", "2 配对 / 参数映射预览", "3 确认应用"].map(
          (label, i) => (
            <div
              key={label}
              className={`border p-3 text-center font-semibold ${step === i + 1 ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"}`}
            >
              {label}
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
            选择{" "}
            {mode === "function"
              ? "JSON 测试数组"
              : "成对 .in / .out 文件或 JSON 测试数组"}
          </p>
          <Button className="mt-4" onClick={() => fileRef.current?.click()}>
            选择文件
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
          <Table min={400} headers={["测试", "输入 / 参数", "期望结果"]}>
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
            <b>追加测试</b>
            <p className="mt-1 text-xs text-muted-foreground">
              保留当前 {currentCount} 个正式测试。
            </p>
          </button>
          <button
            className={`border p-4 text-left ${replace ? "border-destructive bg-destructive/5" : "border-border"}`}
            onClick={() => setReplace(true)}
          >
            <b>替换全部正式测试</b>
            <p className="mt-1 text-xs text-muted-foreground">
              替换当前草稿；已发布版本保留。
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
          上一步
        </Button>
        {step < 3 ? (
          <Button
            disabled={!rows.length || action.busy}
            onClick={() => setStep((x) => x + 1)}
          >
            下一步
          </Button>
        ) : (
          <Button
            variant={replace ? "danger" : "primary"}
            onClick={() => {
              if (
                !replace ||
                window.confirm(`确认替换当前草稿的 ${currentCount} 个测试？`)
              )
                onApply(rows, replace);
            }}
          >
            {replace ? "确认替换" : "确认追加"} {rows.length} 个测试
          </Button>
        )}
      </div>
    </Modal>
  );
}
