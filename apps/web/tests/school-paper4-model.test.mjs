import test from "node:test";
import assert from "node:assert/strict";
import {
  originalPaper,
  paper4DraftFrom,
  paper4VisiblePapers,
  schoolPaper4Location,
} from "../src/components/schools/school-paper4-model.ts";

const paper = (id, year, session, variant) => ({
  id,
  title: id,
  shortTitle: id,
  description: "",
  revision: 1,
  published: true,
  versionId: "v",
  archived: false,
  questionCount: 3,
  totalMarks: 75,
  exam: { examYear: year, examSession: session, examVariant: variant },
  canManage: false,
});
test("Paper 4 navigation preserves school, list filters and course context across opening and returning", () => {
  const initial =
    "schoolId=alpha&section=paper4&paper4Year=2026&paper4Session=summer&courseId=c&chapterId=q";
  const opened = schoolPaper4Location(initial, {
    paper4AttemptId: "attempt-1",
    paper4Question: "Q2",
  });
  const next = schoolPaper4Location(opened, { paper4AttemptId: "attempt-2" });
  const params = new URLSearchParams(next);
  assert.equal(params.get("schoolId"), "alpha");
  assert.equal(params.get("paper4Question"), "Q2");
  assert.equal(params.get("courseId"), "c");
  assert.equal(params.get("chapterId"), "q");
  assert.equal(
    schoolPaper4Location(next, { paper4AttemptId: null, paper4Question: null }),
    `?${initial}`,
  );
});
test("year and session filters drive a stable paper order rather than database insertion order", () => {
  const rows = [
    paper("old", 2021, "summer", 41),
    paper("b", 2026, "summer", 42),
    paper("a", 2026, "summer", 41),
    paper("autumn", 2025, "autumn", 43),
    paper("summer", 2025, "summer", 41),
  ];
  assert.deepEqual(
    paper4VisiblePapers(rows, "", "").map((p) => p.id),
    ["a", "b", "autumn", "summer", "old"],
  );
  assert.deepEqual(
    paper4VisiblePapers(rows, "2026", "summer").map((p) => p.id),
    ["a", "b"],
  );
  assert.deepEqual(
    rows.map((p) => p.id),
    ["old", "b", "a", "autumn", "summer"],
  );
});
test("PDF adapter retains exact original question wording and exam identity without reference code or tests", () => {
  const questions = [
    {
      key: "Q1",
      title: "Queue",
      statement: "Original\n\nspacing",
      starterCode: "",
      initialFiles: {},
      stages: [],
    },
  ];
  const result = originalPaper(paper("paper", 2026, "summer", 41), {
    language: "python",
    questions,
    exam: { examYear: 2026, examSession: "summer", examVariant: 41 },
    totalMarks: 75,
  });
  assert.equal(result.questions[0].statement, "Original\n\nspacing");
  assert.equal(result.examYear, 2026);
  assert.equal(result.examVariant, 41);
  assert.equal(result.examSession, "summer");
  assert.equal("referenceSolutions" in result, false);
  assert.equal("runnerCases" in result, false);
});
test("independent new paper drafts do not share question or stage mutation state", () => {
  const first = paper4DraftFrom(null),
    second = paper4DraftFrom(null);
  first.questions[0].statement = "changed";
  first.questions[0].stages[0].maxMarks = 5;
  assert.equal(second.questions[0].statement, "");
  assert.equal(second.questions[0].stages[0].maxMarks, 75);
});
