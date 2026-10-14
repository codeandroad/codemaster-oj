export function jsonValue(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("请输入有效的 JSON。");
  }

  let nodes = 0;
  const check = (entry: unknown, depth: number): void => {
    if (depth > 64 || ++nodes > 50000) throw new Error("JSON 超过嵌套或节点数量限制。");
    if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error("JSON 数字必须有限。");
    if (entry && typeof entry === "object") {
      for (const child of Object.values(entry)) check(child, depth + 1);
    }
  };
  check(value, 0);
  return value;
}

export function validateFunctionInput(text: string): void {
  const value = jsonValue(text);
  if (Array.isArray(value)) return;

  const validObject = value !== null && typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>).args) &&
    Object.keys(value).every(key => key === "args" || key === "kwargs") &&
    (!Object.hasOwn(value, "kwargs") ||
      (typeof (value as Record<string, unknown>).kwargs === "object" &&
        (value as Record<string, unknown>).kwargs !== null &&
        !Array.isArray((value as Record<string, unknown>).kwargs)));
  if (!validObject) throw new Error("函数参数须为 JSON 数组或含 args 与可选 kwargs 的对象。");
}
