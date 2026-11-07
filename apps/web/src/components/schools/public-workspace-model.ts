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
  if (problem.versionId) params.set("versionId", problem.versionId); else params.delete("versionId");
  return `/practice/problems?${params}`;
}
export function publicPracticeReturnHref(search: string) {
  const params = new URLSearchParams(search);
  const course = params.get("publicCourseId"), chapter = params.get("publicChapterId");
  if (course && chapter) return `/practice/courses/${encodeURIComponent(course)}?${new URLSearchParams({chapterId: chapter, ...(params.get("courseQ") ? {courseQ: params.get("courseQ")!} : {})})}`;
  for (const key of ["problemId", "versionId", "publicCourseId", "publicChapterId", "courseQ"]) params.delete(key);
  return `/practice/problems${params.size ? `?${params}` : ""}`;
}
export function publicDraftStorage(userId: string, problem: Problem, storage: Pick<Storage,"getItem"|"setItem">) {
  const key = (language: SubmissionLanguage) => `codemaster:public-workspace:${userId}:${problem.id}:${problem.versionId}:${language}`;
  const legacy = `codemaster:school-practice:${userId}:${problem.schoolId}:${problem.id}:${problem.versionId}`;
  return {
    readDraft(language: SubmissionLanguage): StudentDraft | null {
      try {
        const raw = storage.getItem(key(language));
        if (raw !== null) {
          const value = JSON.parse(raw);
          if (typeof value?.code === "string" && typeof value?.receivedCode === "string") return value;
          return null;
        }
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
