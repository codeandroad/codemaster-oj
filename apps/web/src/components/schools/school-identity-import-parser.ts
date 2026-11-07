export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

export type IdentityImportRow = { number: string; name: string };
export type IdentityImportParseCode =
  | "FILE_TYPE"
  | "FILE_SIZE"
  | "EMPTY_FILE"
  | "CSV_FORMAT"
  | "HEADER"
  | "ROW_LIMIT"
  | "COLUMNS"
  | "WORKBOOK"
  | "FORMULA";

export class IdentityImportParseError extends Error {
  readonly code: IdentityImportParseCode;

  constructor(code: IdentityImportParseCode) {
    super(code);
    this.name = "IdentityImportParseError";
    this.code = code;
  }
}

/** Keep identifiers as text. Empty interior rows remain visible to server validation. */
export function identityRowsFromMatrix(
  matrix: unknown[][],
): IdentityImportRow[] {
  const rows = matrix.map((row) => row.map((cell) => String(cell ?? "")));
  while (rows.length && rows.at(-1)!.every((cell) => !cell.trim())) rows.pop();
  if (!rows.length) throw new IdentityImportParseError("EMPTY_FILE");
  const header = rows[0].map((cell) =>
    cell
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase(),
  );
  if (
    header.length !== 2 ||
    !header.includes("number") ||
    !header.includes("name")
  ) {
    throw new IdentityImportParseError("HEADER");
  }
  if (rows.length === 1) throw new IdentityImportParseError("EMPTY_FILE");
  if (rows.length - 1 > MAX_IMPORT_ROWS)
    throw new IdentityImportParseError("ROW_LIMIT");
  const numberIndex = header.indexOf("number");
  const nameIndex = header.indexOf("name");
  return rows.slice(1).map((row) => {
    if (row.length > 2) throw new IdentityImportParseError("COLUMNS");
    return {
      number: (row[numberIndex] ?? "").trim(),
      name: (row[nameIndex] ?? "").trim(),
    };
  });
}

/** RFC-style CSV quoting; never coerce IDs to numbers or evaluate formulas. */
export function parseIdentityCsv(source: string): IdentityImportRow[] {
  const text = source.replace(/^\uFEFF/, "");
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else field += char;
    } else if (char === "," || char === "\r" || char === "\n") {
      row.push(field);
      field = "";
      closedQuote = false;
      if (char !== ",") {
        matrix.push(row);
        row = [];
        if (char === "\r" && text[index + 1] === "\n") index += 1;
      }
    } else if (char === '"' && !field && !closedQuote) {
      quoted = true;
    } else {
      if (closedQuote || char === '"')
        throw new IdentityImportParseError("CSV_FORMAT");
      field += char;
    }
  }
  if (quoted) throw new IdentityImportParseError("CSV_FORMAT");
  row.push(field);
  matrix.push(row);
  return identityRowsFromMatrix(matrix);
}

export async function parseIdentityFile(
  file: File,
): Promise<IdentityImportRow[]> {
  if (!/\.(csv|xlsx)$/i.test(file.name))
    throw new IdentityImportParseError("FILE_TYPE");
  if (file.size > MAX_IMPORT_BYTES)
    throw new IdentityImportParseError("FILE_SIZE");
  if (!file.size) throw new IdentityImportParseError("EMPTY_FILE");
  if (/\.csv$/i.test(file.name)) return parseIdentityCsv(await file.text());
  try {
    const xlsx = await import("xlsx");
    const workbook = xlsx.read(await file.arrayBuffer(), {
      type: "array",
      sheetRows: MAX_IMPORT_ROWS + 2,
      cellFormula: true,
      cellText: true,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet?.["!ref"]) throw new IdentityImportParseError("WORKBOOK");
    const range = xlsx.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
    if (range.e.r > MAX_IMPORT_ROWS)
      throw new IdentityImportParseError("ROW_LIMIT");
    if (range.e.c > 1) throw new IdentityImportParseError("COLUMNS");
    for (const [address, cell] of Object.entries(sheet)) {
      if (
        !address.startsWith("!") &&
        cell &&
        typeof cell === "object" &&
        "f" in cell
      ) {
        throw new IdentityImportParseError("FORMULA");
      }
    }
    return identityRowsFromMatrix(
      xlsx.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: true,
        range: 0,
      }),
    );
  } catch (error) {
    if (error instanceof IdentityImportParseError) throw error;
    throw new IdentityImportParseError("WORKBOOK");
  }
}

export function schoolIdentityCsvTemplate(kind: "student" | "teacher"): string {
  const role = kind === "teacher" ? "Teacher" : "Student";
  return `\uFEFFnumber,name\r\n000001,Fictional ${role} A\r\n000002,Fictional ${role} B\r\n`;
}
