import type { ProductionProblem, SubmissionLanguage } from "@/lib/production-api";
import type { StudentDraft } from "@/components/student/drafts";
import type { Problem } from "./school-practice-types";

/** Keep the public view explicit: author-only fields are not workspace data. */
export function publicWorkspaceProblem(problem: Problem): ProductionProblem {
  const definition = problem.definition!;
  return { id: problem.id, title: problem.title, versionId: problem.versionId ?? undefined,
    solved: problem.solved, published: problem.published, bankId: problem.bankId,
    mode: definition.mode, statement: definition.statement, functionName: definition.functionName,
    starterCode: definition.starterCode, starterCodes: definition.starterCodes,
    difficulty: definition.difficulty, objective: definition.objective,
    parameters: definition.parameters, returnType: definition.returnType, tags: definition.tags,
    samples: definition.samples.map(({input, expected}) => ({input, expected})),
    timeLimitMs: definition.timeLimitMs, memoryLimitMb: definition.memoryLimitMb };
}

export function publicPracticeHref(problem: {problemId: string; versionId?: string}, search: string) {
  const params = new URLSearchParams(search);
  params.set("problemId", problem.problemId);
  params.delete("versionId");
  return `/practice/problems?${params}`;
}
export function publicPracticeReturnHref(search: string) {
  const params = new URLSearchParams(search);
  const course = params.get("publicCourseId"), chapter = params.get("publicChapterId");
  if (course && chapter) return `/practice/courses/${encodeURIComponent(course)}?${new URLSearchParams({chapterId: chapter, ...(params.get("courseQ") ? {courseQ: params.get("courseQ")!} : {})})}`;
  for (const key of ["problemId", "versionId", "publicCourseId", "publicChapterId", "courseQ"]) params.delete(key);
  return `/practice/problems${params.size ? `?${params}` : ""}`;
}
export function publicDraftStorage(userId: string, problem: Problem, storage: Pick<Storage,"getItem"|"setItem"> & Partial<Pick<Storage,"key"|"length">>) {
  const prefix = `codemaster:public-workspace:${userId}:${problem.id}:`;
  const key = (language: SubmissionLanguage) => `${prefix}current:${language}`;
  const legacy = `codemaster:school-practice:${userId}:${problem.schoolId}:${problem.id}:${problem.versionId}`;
  const parse = (raw: string | null): StudentDraft | null => {
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      return typeof value?.code === "string" && typeof value?.receivedCode === "string" ? value : null;
    } catch { return null; }
  };
  return {
    readDraft(language: SubmissionLanguage): StudentDraft | null {
      try {
        const current = parse(storage.getItem(key(language)));
        if (current) return current;
        const older = [parse(storage.getItem(`${prefix}${problem.versionId}:${language}`))].filter((draft): draft is StudentDraft => draft !== null);
        // Old version keys stay untouched. Recover only this user's same
        // exercise and language when the current statement has advanced.
        if (storage.key && typeof storage.length === "number") {
          for (let i = 0; i < storage.length; i++) {
            const candidate = storage.key(i);
            if (!candidate?.startsWith(prefix) || !candidate.endsWith(`:${language}`)) continue;
            const draft = parse(storage.getItem(candidate));
            if (draft) older.push(draft);
          }
        }
        older.sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0));
        if (older[0]) return older[0];
        const code = language === "python" ? storage.getItem(legacy) : null;
        // The earlier editor did not record a submission baseline. Keep the code,
        // but never claim it was submitted merely because it was locally saved.
        return code === null ? null : {code, receivedCode: problem.definition?.starterCode ?? "", updatedAt: new Date().toISOString()};
      } catch { return null; }
    },
    saveDraft(language: SubmissionLanguage, draft: StudentDraft) {
      try { storage.setItem(key(language), JSON.stringify(draft)); return true; } catch { return false; }
    },
  };
}
