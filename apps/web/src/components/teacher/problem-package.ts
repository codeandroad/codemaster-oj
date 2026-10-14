import { parseDocument } from "yaml";
import type { ProductionProblem } from "@/lib/production-api";
import { equalCaseWeights } from "./case-weights";

export type ImportCandidate = Partial<ProductionProblem> &
  Record<string, unknown> & { _importWarnings?: string[] };
export interface ProblemImport {
  rows: ImportCandidate[];
  files: string[];
}
interface ZipEntry {
  name: string;
  data: Uint8Array;
}
interface Case {
  input: string;
  expected: string;
  name?: string;
  enabled?: boolean;
}
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 512;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pathSafe(name: string) {
  return (
    !!name &&
    !/[\\:\x00-\x1f\x7f]/.test(name) &&
    !name.startsWith("/") &&
    name
      .split("/")
      .every(
        (part, index, parts) =>
          part !== "." &&
          part !== ".." &&
          (part !== "" || index === parts.length - 1),
      )
  );
}
function decode(entry: ZipEntry) {
  try {
    return utf8.decode(entry.data);
  } catch {
    throw new Error(`${entry.name} 须为 UTF-8 文本。`);
  }
}
/** Reads standard single-disk ZIP in memory. No file-system extraction, code execution or remote fetch. */
export async function readZipEntries(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  if (buffer.byteLength > MAX_BYTES) throw new Error("ZIP 文件不能超过 2 MB。");
  const view = new DataView(buffer),
    bytes = new Uint8Array(buffer);
  let end = -1;
  for (
    let at = buffer.byteLength - 22;
    at >= Math.max(0, buffer.byteLength - 65_557);
    at--
  ) {
    if (
      view.getUint32(at, true) === 0x06054b50 &&
      at + 22 + view.getUint16(at + 20, true) === buffer.byteLength
    ) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP 目录无效。请选择标准 ZIP 或 JSON 清单。");
  const count = view.getUint16(end + 10, true),
    directorySize = view.getUint32(end + 12, true),
    directory = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    count === 65_535 ||
    directory === 0xffffffff ||
    directory + directorySize !== end
  )
    throw new Error("不支持分卷、ZIP64 或损坏的 ZIP 目录。");
  if (count > MAX_FILES)
    throw new Error(`ZIP 最多包含 ${MAX_FILES} 个文件与目录。`);
  let cursor = directory,
    total = 0;
  const entries: ZipEntry[] = [],
    names = new Set<string>(),
    occupied: { start: number; end: number }[] = [];
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("ZIP 文件目录损坏。");
    const flags = view.getUint16(cursor + 8, true),
      method = view.getUint16(cursor + 10, true),
      crc = view.getUint32(cursor + 16, true),
      compressed = view.getUint32(cursor + 20, true),
      expanded = view.getUint32(cursor + 24, true),
      nameLength = view.getUint16(cursor + 28, true),
      extraLength = view.getUint16(cursor + 30, true),
      commentLength = view.getUint16(cursor + 32, true),
      disk = view.getUint16(cursor + 34, true),
      unixType = (view.getUint32(cursor + 38, true) >>> 16) & 0xf000,
      offset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new Error("ZIP 文件名或目录超出边界。");
    let name: string;
    try {
      name = utf8
        .decode(bytes.slice(cursor + 46, cursor + 46 + nameLength))
        .normalize("NFC");
    } catch {
      throw new Error("ZIP 文件名须采用 UTF-8。");
    }
    cursor = next;
    if (!pathSafe(name)) throw new Error("ZIP 包含不安全的文件路径。");
    const key = name.replace(/\/$/, "").toLowerCase();
    if (names.has(key)) throw new Error(`ZIP 存在重复文件路径：${name}`);
    names.add(key);
    if (
      flags & 0x2061 ||
      disk ||
      (unixType && unixType !== 0x8000 && unixType !== 0x4000) ||
      (unixType === 0x4000 && !name.endsWith("/"))
    )
      throw new Error("ZIP 包含加密、符号链接或其他不支持的文件类型。");
    if (![0, 8].includes(method))
      throw new Error("ZIP 压缩格式暂不支持，请使用 stored/deflate 或 JSON。");
    if (
      expanded > MAX_BYTES ||
      total + expanded > MAX_BYTES ||
      (expanded > 64 * 1024 && expanded / Math.max(1, compressed) > 1000)
    )
      throw new Error("ZIP 解压内容或压缩比超过限制（合计 2 MB）。");
    if (offset + 30 > directory || view.getUint32(offset, true) !== 0x04034b50)
      throw new Error("ZIP 文件头无效。");
    const localNameLength = view.getUint16(offset + 26, true),
      localExtra = view.getUint16(offset + 28, true),
      start = offset + 30 + localNameLength + localExtra;
    if (
      start + compressed > directory ||
      view.getUint16(offset + 6, true) !== flags ||
      view.getUint16(offset + 8, true) !== method
    )
      throw new Error("ZIP 内容或文件头超出边界。");
    let localName: string;
    try {
      localName = utf8
        .decode(bytes.slice(offset + 30, offset + 30 + localNameLength))
        .normalize("NFC");
    } catch {
      throw new Error("ZIP 本地文件名无效。");
    }
    if (
      localName !== name ||
      (!(flags & 8) &&
        (view.getUint32(offset + 14, true) !== crc ||
          view.getUint32(offset + 18, true) !== compressed ||
          view.getUint32(offset + 22, true) !== expanded))
    )
      throw new Error("ZIP 本地文件头与目录不一致。");
    if (
      occupied.some(
        (range) => offset < range.end && start + compressed > range.start,
      )
    )
      throw new Error("ZIP 文件内容重叠。");
    occupied.push({ start: offset, end: start + compressed });
    const chunk = bytes.slice(start, start + compressed);
    let data: Uint8Array;
    if (method === 0) data = chunk;
    else {
      try {
        const reader = new Blob([chunk])
            .stream()
            .pipeThrough(new DecompressionStream("deflate-raw"))
            .getReader(),
          chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          length += item.value.byteLength;
          if (length > expanded || length > MAX_BYTES - total) {
            await reader.cancel();
            throw new Error("ZIP 解压长度超过目录或 2 MB 限制。");
          }
          chunks.push(item.value);
        }
        data = new Uint8Array(length);
        let at = 0;
        for (const item of chunks) {
          data.set(item, at);
          at += item.byteLength;
        }
      } catch (error) {
        throw new Error(
          error instanceof Error && error.message.startsWith("ZIP")
            ? error.message
            : `ZIP 无法解压 ${name}，请使用标准 deflate 格式。`,
        );
      }
    }
    if (data.byteLength !== expanded || crc32(data) !== crc)
      throw new Error(`ZIP 文件长度或 CRC 校验失败：${name}`);
    total += data.byteLength;
    if (!name.endsWith("/")) entries.push({ name, data });
  }
  if (cursor !== directory + directorySize)
    throw new Error("ZIP 文件目录长度不一致。");
  return entries;
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} 须为对象。`);
  return value as Record<string, unknown>;
}
function safeConfig(value: unknown, label: string) {
  let budget = 10_000;
  const active = new Set<object>();
  const walk = (current: unknown, depth: number) => {
    if (--budget < 0 || depth > 20)
      throw new Error(`${label} 配置结构过大或过深。`);
    if (!current || typeof current !== "object") return;
    if (active.has(current)) throw new Error(`${label} 不支持循环引用。`);
    active.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error(`${label} 包含不支持的配置键。`);
      walk(child, depth + 1);
    }
    active.delete(current);
  };
  walk(value, 0);
  return record(value, label);
}
function configFile(entry: ZipEntry) {
  if (entry.data.byteLength > 64 * 1024)
    throw new Error(`${entry.name} 配置不能超过 64 KB。`);
  const text = decode(entry);
  if (entry.name.toLowerCase().endsWith(".json"))
    return safeConfig(JSON.parse(text), entry.name);
  const doc = parseDocument(text, {
    schema: "core",
    uniqueKeys: true,
    stringKeys: true,
    logLevel: "silent",
  });
  if (doc.errors.length || doc.warnings.length)
    throw new Error(
      `${entry.name} YAML 无效或包含不支持的标签：${doc.errors[0]?.message ?? doc.warnings[0]?.message}`,
    );
  return safeConfig(doc.toJS({ maxAliasCount: 20 }), entry.name);
}
function markdownSamples(statement: string) {
  const inputs: { key: string; input: string; expected?: string }[] = [],
    warnings: string[] = [];
  let heading = "",
    index = 0;
  const lines = statement.replace(/\r\n/g, "\n").split("\n");
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!,
      title = /^\s*#{1,6}\s+(.+)$/.exec(line);
    if (title) heading = title[1]!;
    const fence = /^\s*(`{3,}|~{3,})\s*([^\s]*)/.exec(line);
    if (!fence) continue;
    const label = fence[2]!,
      context = `${heading} ${label}`,
      sampleContext =
        /样例|示例|sample|example/i.test(context) ||
        /^(?:input|output)\d*$/i.test(label);
    const direction = /^(input|output)\d*$/i.exec(label)?.[1]?.toLowerCase();
    const kind =
      direction === "input"
        ? "input"
        : direction === "output"
          ? "output"
          : sampleContext && /输入|input/i.test(context)
            ? "input"
            : sampleContext && /输出|output/i.test(context)
              ? "output"
              : "";
    const content: string[] = [];
    for (
      at++;
      at < lines.length &&
      !new RegExp(`^\\s*${fence[1]![0]}{${fence[1]!.length},}\\s*$`).test(
        lines[at]!,
      );
      at++
    )
      content.push(lines[at]!);
    if (!kind) continue;
    const number = /(?:input|output|样例|示例)\s*(\d+)/i.exec(context)?.[1];
    if (kind === "input")
      inputs.push({
        key: number ?? String(++index),
        input: content.join("\n"),
      });
    else {
      const item = number
        ? inputs.find((x) => x.key === number && x.expected === undefined)
        : inputs.find((x) => x.expected === undefined);
      if (item) item.expected = content.join("\n");
      else warnings.push("题面中的样例输出没有对应的样例输入。");
    }
  }
  const samples = inputs.flatMap((item, at) =>
    item.expected === undefined
      ? (warnings.push("题面中的样例输入缺少对应的样例输出。"), [])
      : [
          {
            name: `Sample ${at + 1}`,
            input: item.input,
            expected: item.expected,
          },
        ],
  );
  return { samples, warnings };
}
function numericLimit(
  value: unknown,
  fallback: number,
  unit: "time" | "memory",
) {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  if (typeof value !== "string") throw new Error("题包时间/内存配置格式无效。");
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|mb|mib)?\s*$/i.exec(value);
  if (!match) throw new Error("时间须使用毫秒或 s/ms；内存须使用 MB/MiB。");
  const n = Number(match[1]),
    suffix = (match[2] ?? "").toLowerCase();
  if (unit === "time" && ["", "ms", "s"].includes(suffix))
    return suffix === "s" ? n * 1000 : n;
  if (unit === "memory" && ["", "m", "mb", "mib"].includes(suffix)) return n;
  throw new Error("题包时间/内存配置单位无效。");
}
function packageRow(
  statementFile: ZipEntry,
  all: ZipEntry[],
  archive: string,
  packageRoots: string[],
): ImportCandidate {
  const root = statementFile.name.slice(0, -"problem.md".length),
    lowerRoot = root.toLowerCase(),
    local = all.filter(
      (file) =>
        file.name.toLowerCase().startsWith(lowerRoot) &&
        !packageRoots.some(
          (other) =>
            other !== lowerRoot &&
            other.startsWith(lowerRoot) &&
            file.name.toLowerCase().startsWith(other),
        ),
    );
  const find = (name: string) =>
    local.find((file) => file.name.toLowerCase() === name.toLowerCase());
  const configEntries = [
    "config.json",
    "config.yaml",
    "config.yml",
    "problem.json",
    "problem.yaml",
    "problem.yml",
    "testdata/config.json",
    "testdata/config.yaml",
    "testdata/config.yml",
    "tests/config.json",
    "tests/config.yaml",
    "tests/config.yml",
  ].flatMap((name) => {
    const file = find(root + name);
    return file ? [file] : [];
  });
  let config: Record<string, unknown> = {};
  for (const file of configEntries) config = { ...config, ...configFile(file) };
  const configDirectory =
      configEntries.at(-1)?.name.replace(/[^/]+$/, "") ?? root,
    statement = decode(statementFile),
    warnings: string[] = [];
  const resolve = (value: string) => {
    if (!pathSafe(value) || value.endsWith("/"))
      throw new Error("题包配置包含不安全的文件引用。");
    return find(root + value) ?? find(configDirectory + value);
  };
  const textOrFile = (
    value: unknown,
    fallbackNames: string[] = [],
    fileReference = false,
  ) => {
    if (value !== undefined) {
      if (typeof value !== "string")
        throw new Error("题包代码/文件引用须为字符串。");
      if (fileReference && (!pathSafe(value) || value.endsWith("/")))
        throw new Error("题包配置包含不安全的文件引用。");
      const file =
        value && !value.includes("\n") && pathSafe(value)
          ? resolve(value)
          : undefined;
      if (file) return decode(file);
      if (
        fileReference ||
        (!value.includes("\n") && /\.(?:py|cpp|cc|js|mjs|in|out)$/i.test(value))
      )
        throw new Error(`题包缺少配置引用的文件：${value}`);
      return value;
    }
    for (const name of fallbackNames) {
      const file = find(root + name);
      if (file) return decode(file);
    }
    return "";
  };
  const samplePath = (name: string) =>
    /(?:^|\/)(?:samples?|examples?)(?:\/|[-_.\d])/i.test(
      name.slice(root.length),
    );
  const pairs = (sample: boolean) => {
    const selected = local.filter(
        (file) =>
          /\.(?:in|out)$/i.test(file.name) && samplePath(file.name) === sample,
      ),
      inputs = selected.filter((file) => /\.in$/i.test(file.name)),
      result: Case[] = [];
    for (const file of inputs) {
      const output = selected.find(
        (entry) =>
          entry.name.toLowerCase() ===
          file.name.replace(/\.in$/i, ".out").toLowerCase(),
      );
      if (!output) {
        warnings.push(`${file.name} 缺少配对输出，未导入该测试。`);
        continue;
      }
      if (
        file.data.byteLength > 128 * 1024 ||
        output.data.byteLength > 128 * 1024
      )
        throw new Error(`${file.name} 测试输入/输出不能超过 128 KB。`);
      result.push({
        name: file.name.slice(root.length).replace(/\.in$/i, ""),
        input: decode(file),
        expected: decode(output),
        enabled: true,
      });
    }
    for (const file of selected.filter((file) => /\.out$/i.test(file.name)))
      if (
        !inputs.some(
          (entry) =>
            entry.name.toLowerCase() ===
            file.name.replace(/\.out$/i, ".in").toLowerCase(),
        )
      )
        warnings.push(`${file.name} 缺少配对输入，未导入该测试。`);
    return result.sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", "en", { numeric: true }),
    );
  };
  const configuredCases = (value: unknown, label: string) => {
    if (!Array.isArray(value)) throw new Error(`${label} 配置须为数组。`);
    return value.map((item, at): Case => {
      const c = record(item, label),
        input = textOrFile(
          c.input ?? c.in ?? c.inputFile,
          [],
          c.input === undefined &&
            c.in === undefined &&
            c.inputFile !== undefined,
        ),
        expected = textOrFile(
          c.expected ?? c.output ?? c.out ?? c.outputFile,
          [],
          c.expected === undefined &&
            c.output === undefined &&
            c.out === undefined &&
            c.outputFile !== undefined,
        );
      if (
        (c.input === undefined &&
          c.in === undefined &&
          c.inputFile === undefined) ||
        (c.expected === undefined &&
          c.output === undefined &&
          c.out === undefined &&
          c.outputFile === undefined)
      )
        throw new Error(`${label} 第 ${at + 1} 项须同时指定输入和输出。`);
      if (
        new TextEncoder().encode(input).byteLength > 128 * 1024 ||
        new TextEncoder().encode(expected).byteLength > 128 * 1024
      )
        throw new Error(`${label} 单个输入/输出不能超过 128 KB。`);
      return {
        name: typeof c.name === "string" ? c.name : `${label} ${at + 1}`,
        input,
        expected,
        enabled: c.enabled !== false,
      };
    });
  };
  const md = markdownSamples(statement),
    fileSamples = pairs(true),
    rawTests = config.tests ?? config.cases;
  // Unsupported subtask scoring cannot be silently converted to equal-weight judging.
  if (config.subtasks !== undefined)
    throw new Error(
      "题包含子任务计分，请将测试展开为 tests/cases 数组后导入。当前平台按启用测试点等权计分。",
    );
  const samples =
      config.samples !== undefined
        ? configuredCases(config.samples, "样例")
        : fileSamples.length
          ? fileSamples
          : md.samples,
    tests =
      rawTests !== undefined ? configuredCases(rawTests, "测试") : pairs(false);
  warnings.push(...md.warnings);
  if (samples.length > 20 || tests.length > 100)
    throw new Error("每题最多 20 个公开样例、100 个正式测试。");
  const configuredMode =
      config.mode ??
      config.interfaceType ??
      (config.type === "function" ? "function" : "stdio"),
    mode = ["function", "Function"].includes(String(configuredMode))
      ? "function"
      : ["stdio", "Standard I/O", "default"].includes(String(configuredMode))
        ? "stdio"
        : null;
  if (!mode) throw new Error("题包仅支持标准 I/O 或函数题接口。");
  const configuredReferenceLanguage = config.referenceLanguage ?? config.reference_language;
  const referenceLanguage = configuredReferenceLanguage === undefined
    ? ["python", "cpp", "javascript"].find((language) =>
        (language === "python" ? ["reference.py", "solution.py", "std.py"]
          : language === "cpp" ? ["reference.cpp", "solution.cpp", "std.cpp"]
            : ["reference.js", "solution.js", "std.js"]).some((name) => find(root + name))) ?? "python"
    : String(configuredReferenceLanguage);
  if (!["python", "cpp", "javascript"].includes(referenceLanguage))
    throw new Error("参考解答语言须为 python、cpp 或 javascript。");
  const referenceFallback = referenceLanguage === "cpp"
    ? ["reference.cpp", "solution.cpp", "std.cpp", "solutions/reference.cpp", "solutions/solution.cpp"]
    : referenceLanguage === "javascript"
      ? ["reference.js", "solution.js", "std.js", "solutions/reference.js", "solutions/solution.js"]
      : ["reference.py", "solution.py", "std.py", "solutions/reference.py", "solutions/solution.py"];
  const configuredStarters = config.starterCodes ?? config.starter_codes ?? {};
  if (!configuredStarters || typeof configuredStarters !== "object" || Array.isArray(configuredStarters))
    throw new Error("多语言初始模板须为按语言命名的对象。");
  const starterValues = configuredStarters as Record<string, unknown>;
  if (Object.keys(starterValues).some((language) => !["python", "cpp", "javascript"].includes(language)))
    throw new Error("多语言初始模板只能包含 python、cpp、javascript。");
  const referenceCode = textOrFile(
      config.referenceCode ??
        config.reference ??
        config.reference_code ??
        config.solution,
      referenceFallback,
    ),
    starterCode = textOrFile(
      config.starterCode ?? config.starter ?? config.template ?? starterValues.python,
      ["starter.py", "template.py"],
    ),
    starterCodes = {
      cpp: textOrFile(starterValues.cpp, ["starter.cpp", "template.cpp"]),
      javascript: textOrFile(starterValues.javascript, ["starter.js", "template.js"]),
    };
  if (!referenceCode.trim())
    warnings.push("未提供教师参考解，保存为待完善草稿。");
  if (!samples.length) warnings.push("缺少公开样例，保存为待完善草稿。");
  if (!tests.some((test) => test.enabled !== false))
    warnings.push("缺少启用的正式测试，保存为待完善草稿。");
  const title = [
      config.title,
      config.name,
      /^\s*#\s+(.+)$/m.exec(statement)?.[1],
      root.replace(/\/$/, "").split("/").at(-1),
      archive.replace(/\.zip$/i, ""),
    ].find((value) => typeof value === "string" && value.trim()) as string,
    tags = config.tags ?? [];
  if (
    !Array.isArray(tags) ||
    tags.some((tag) => typeof tag !== "string" || tag.length > 80) ||
    tags.length > 30
  )
    throw new Error("题包 tags 须为最多 30 项、每项 80 字以内的字符串数组。");
  const source = [
    archive,
    root.replace(/\/$/, ""),
    typeof config.source === "string" ? config.source : "",
    config.owner !== undefined
      ? `Source owner: ${typeof config.owner === "string" || typeof config.owner === "number" ? config.owner : "未注明"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 2000);
  return {
    title,
    mode,
    statement,
    referenceCode,
    referenceLanguage,
    starterCode,
    starterCodes,
    samples,
    tests: equalCaseWeights(tests),
    functionName:
      mode === "function"
        ? String(config.functionName ?? config.function_name ?? "solve")
        : "",
    timeLimitMs: numericLimit(
      config.timeLimitMs ?? config.time_limit ?? config.time,
      2000,
      "time",
    ),
    memoryLimitMb: numericLimit(
      config.memoryLimitMb ?? config.memory_limit ?? config.memory,
      128,
      "memory",
    ),
    comparator: mode === "function" ? "json" : (config.comparator ?? "tokens"),
    tags: [
      ...new Set(tags.map((tag) => (tag as string).trim()).filter(Boolean)),
    ],
    source,
    ...Object.fromEntries(
      [
        "objective",
        "inputDescription",
        "outputDescription",
        "difficulty",
        "parameters",
        "returnType",
        "editorial",
        "hints",
        "hintPolicy",
      ]
        .filter((key) => config[key] !== undefined)
        .map((key) => [key, config[key]]),
    ),
    _importWarnings: [...new Set(warnings)],
  };
}
function validateRows(value: unknown): ImportCandidate[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const pack=value as Record<string,unknown>;
    if(pack.format!=="codemaster-python-practice" || pack.version!==1) throw new Error("不支持的题目包格式或版本。");
    value=pack.problems;
  }
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    value.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  )
    throw new Error("文件须包含 1–100 个题目对象。");
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    MAX_BYTES - 8192
  )
    throw new Error("候选题目转换后的数据超过 2 MB，请拆分导入。");
  return value as ImportCandidate[];
}
export async function readProblemImport(file: File): Promise<ProblemImport> {
  if (file.size > MAX_BYTES) throw new Error("导入文件不能超过 2 MB。");
  if (!file.name.toLowerCase().endsWith(".zip"))
    return {
      rows: validateRows(JSON.parse(await file.text())),
      files: [file.name],
    };
  const entries = await readZipEntries(await file.arrayBuffer()),
    statements = entries.filter((file) =>
      /(?:^|\/)problem\.md$/i.test(file.name),
    ),
    roots = statements.map((file) =>
      file.name.slice(0, -"problem.md".length).toLowerCase(),
    );
  const rows = statements.map((statement) =>
    packageRow(statement, entries, file.name, roots),
  );
  // JSON manifests outside standard packages remain accepted; package configs are never counted as extra problems.
  for (const entry of entries.filter(
    (file) =>
      /\.json$/i.test(file.name) &&
      !roots.some((root) => file.name.toLowerCase().startsWith(root)),
  )) {
    const value: unknown = JSON.parse(decode(entry));
    if (
      /(?:^|\/)config\.json$/i.test(entry.name) &&
      !Array.isArray(value) &&
      (!value || typeof value !== "object" || !("title" in value))
    )
      continue;
    rows.push(
      ...((Array.isArray(value) ? value : [value]) as ImportCandidate[]),
    );
  }
  if (!rows.length)
    throw new Error(
      "ZIP 须含 problem.md 题包，或一个/多个 JSON 题目清单。配置文件与 pid 都可省略。",
    );
  return {
    rows: validateRows(rows),
    files: entries.map((entry) => entry.name),
  };
}
