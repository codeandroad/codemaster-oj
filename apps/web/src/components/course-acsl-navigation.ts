/** Navigation context is a return address, never proof of course or paper access. */
const legacySchoolId = "00000000-0000-4000-8000-000000000052";
const localOrigin = "https://campus.invalid";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contextKeys = ["acslFrom", "courseFrom"] as const;
const filterKeys = ["acslDivision", "acslSeason", "acslRound", "acslSeasons"] as const;
const viewKeys = ["questionId", "coding", "review", "reviewMode", "explanation"] as const;
type Search = Pick<URLSearchParams, "get">;
type Language = "en" | "zh";

function localUrl(value: string | null | undefined) {
  if (!value || value.length > 12000 || !value.startsWith("/") || value.startsWith("//") ||
      /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, localOrigin);
    // Do not accept encoded path separators, dot segments, or duplicate query fields.
    if (url.origin !== localOrigin || url.pathname !== value.split(/[?#]/, 1)[0] ||
        /%/i.test(url.pathname) || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) return null;
    return url;
  } catch { return null; }
}

function location(url: URL) {
  return `${url.pathname}${url.searchParams.size ? `?${url.searchParams}` : ""}`;
}

function copy(source: URLSearchParams, target: URLSearchParams, key: string, valid: (value: string) => boolean) {
  const value = source.get(key);
  if (value !== null && valid(value)) target.set(key, value);
}

function safeHref(value: string | null | undefined, schoolId: string, kind: "acsl" | "course") {
  if (!uuid.test(schoolId)) return null;
  const source = localUrl(value);
  if (!source) return null;
  const params = source.searchParams;
  const output = new URL(source.pathname, localOrigin);
  const result = output.searchParams;
  if (source.pathname.startsWith("/practice/courses/")) {
    const match = source.pathname.match(/^\/practice\/courses\/([^/]+)$/);
    if (kind !== "course" || !match || !uuid.test(match[1]) ||
        params.get("schoolId")?.toLowerCase() !== schoolId.toLowerCase() ||
        params.has("chapterId") && !uuid.test(params.get("chapterId") ?? "")) return null;
    result.set("schoolId", schoolId.toLowerCase());
    if (params.has("chapterId")) result.set("chapterId", params.get("chapterId")!);
  } else if (source.pathname === "/schools") {
    if (schoolId === legacySchoolId || params.get("schoolId")?.toLowerCase() !== schoolId.toLowerCase() ||
        params.get("section") !== (kind === "acsl" ? "acsl" : "courses") ||
        params.has("schoolRole") && params.get("schoolRole") !== "student") return null;
    result.set("schoolId", schoolId.toLowerCase());
    result.set("section", kind === "acsl" ? "acsl" : "courses");
    if (params.has("schoolRole")) result.set("schoolRole", "student");
    if (kind === "course") {
      if (!uuid.test(params.get("courseId") ?? "") || params.has("chapterId") && !uuid.test(params.get("chapterId") ?? "")) return null;
      result.set("courseId", params.get("courseId")!);
      if (params.has("chapterId")) result.set("chapterId", params.get("chapterId")!);
    }
  } else {
    if (schoolId.toLowerCase() !== legacySchoolId || params.has("schoolId") && params.get("schoolId")?.toLowerCase() !== legacySchoolId) return null;
    if (kind === "acsl") {
      if (source.pathname !== "/student/acsl") return null;
    } else {
      const match = source.pathname.match(/^\/student\/learning-paths\/([^/]+)(?:\/chapters\/([^/]+))?$/);
      if (!match || !uuid.test(match[1]) || match[2] !== undefined && !uuid.test(match[2])) return null;
      // Older course links can select a chapter in the query instead of the path.
      copy(params, result, "chapter", value => uuid.test(value));
    }
  }
  copy(params, result, "contentLanguage", value => value === "en" || value === "zh");
  if (kind === "acsl") {
    for (const key of ["paperId", "paperVersionId", "versionId", "writtenRevision"]) {
      if (params.has(key) && !uuid.test(params.get(key)!)) return null;
      copy(params, result, key, value => uuid.test(value));
    }
    copy(params, result, "questionId", value => /^[a-z0-9-]{1,40}$/.test(value));
    for (const key of ["coding", "review", "explanation"]) copy(params, result, key, value => value === "1");
    copy(params, result, "reviewMode", value => value === "wrong" || value === "all");
    copy(params, result, "acslDivision", value => ["Elementary", "Junior", "Intermediate", "Senior"].includes(value));
    copy(params, result, "acslSeason", value => /^\d{4}-\d{4}$/.test(value) && Number(value.slice(5)) === Number(value.slice(0, 4)) + 1);
    copy(params, result, "acslRound", value => /^[1-4]$/.test(value));
    copy(params, result, "acslSeasons", value => /^\d{1,3}$/.test(value) && Number(value) > 0 && Number(value) <= 100);
  }
  return location(output);
}

/** Returns only a canonical student route for the current school, without nested context. */
export function safeAcslHref(value: string | null | undefined, schoolId: string) {
  return safeHref(value, schoolId, "acsl");
}

export function safeCourseHref(value: string | null | undefined, schoolId: string) {
  return safeHref(value, schoolId, "course");
}

function context(search: Search, schoolId: string) {
  return {
    acslFrom: safeAcslHref(search.get("acslFrom"), schoolId),
    courseFrom: safeCourseHref(search.get("courseFrom"), schoolId),
  };
}

/** Use when changing chapters, paper tabs, catalog filters, review mode, or language. */
export function preserveAcslLearningContext(href: string, currentSearch: Search, schoolId: string) {
  const canonical = safeAcslHref(href, schoolId) ?? safeCourseHref(href, schoolId);
  if (!canonical) return null;
  const output = new URL(canonical, localOrigin);
  const language = currentSearch.get("contentLanguage");
  if (!output.searchParams.has("contentLanguage") && (language === "en" || language === "zh")) output.searchParams.set("contentLanguage", language);
  const sources = context(currentSearch, schoolId);
  for (const key of contextKeys) if (sources[key]) output.searchParams.set(key, sources[key]);
  return location(output);
}

/** Open a lesson from the current question or results view. */
export function acslLearningHref(courseHref: string, currentAcslHref: string, schoolId: string, language?: Language) {
  const course = safeCourseHref(courseHref, schoolId), source = safeAcslHref(currentAcslHref, schoolId);
  if (!course || !source) return null;
  const output = new URL(course, localOrigin);
  output.searchParams.set("acslFrom", source);
  const selectedLanguage = language ?? new URL(source, localOrigin).searchParams.get("contentLanguage");
  if (selectedLanguage) output.searchParams.set("contentLanguage", selectedLanguage);
  return location(output);
}

function samePractice(left: URLSearchParams, right: URLSearchParams) {
  return !!left.get("paperId") && left.get("paperId") === right.get("paperId") &&
    left.get("questionId") === right.get("questionId") && left.get("coding") === right.get("coding") &&
    (!left.has("paperVersionId") || !right.has("paperVersionId") || left.get("paperVersionId") === right.get("paperVersionId"));
}

/** Open linked practice, restoring the source view only for the same practice target. */
export function acslPracticeHref(acslHref: string, currentCourseHref: string, schoolId: string, language?: Language) {
  const target = safeAcslHref(acslHref, schoolId), course = safeCourseHref(currentCourseHref, schoolId);
  const current = localUrl(currentCourseHref);
  if (!target || !course || !current) return null;
  const output = new URL(target, localOrigin);
  const source = safeAcslHref(current.searchParams.get("acslFrom"), schoolId);
  if (source) {
    const previous = new URL(source, localOrigin).searchParams;
    for (const key of filterKeys) if (!output.searchParams.has(key) && previous.has(key)) output.searchParams.set(key, previous.get(key)!);
    if (samePractice(output.searchParams, previous)) {
      for (const key of viewKeys) if (previous.has(key)) output.searchParams.set(key, previous.get(key)!);
    }
    output.searchParams.set("acslFrom", source);
  }
  const selectedLanguage = language ?? current.searchParams.get("contentLanguage");
  if (selectedLanguage === "en" || selectedLanguage === "zh") output.searchParams.set("contentLanguage", selectedLanguage);
  // Carry the active language back to the chapter too; no second course is created.
  const returnCourse = new URL(course, localOrigin);
  if (selectedLanguage === "en" || selectedLanguage === "zh") returnCourse.searchParams.set("contentLanguage", selectedLanguage);
  output.searchParams.set("courseFrom", location(returnCourse));
  return location(output);
}

export function courseReturnHref(search: Search, schoolId: string) {
  const sources = context(search, schoolId);
  if (!sources.courseFrom) return null;
  const target = new URL(sources.courseFrom, localOrigin);
  const language = search.get("contentLanguage");
  if (language === "en" || language === "zh") target.searchParams.set("contentLanguage", language);
  return preserveAcslLearningContext(location(target), new URLSearchParams(sources.acslFrom ? { acslFrom: sources.acslFrom } : {}), schoolId);
}

export function acslReturnHref(search: Search, schoolId: string) {
  const sources = context(search, schoolId);
  if (!sources.acslFrom) return null;
  const target = new URL(sources.acslFrom, localOrigin);
  const language = search.get("contentLanguage");
  if (language === "en" || language === "zh") target.searchParams.set("contentLanguage", language);
  return preserveAcslLearningContext(location(target), new URLSearchParams(sources.courseFrom ? { courseFrom: sources.courseFrom } : {}), schoolId);
}
