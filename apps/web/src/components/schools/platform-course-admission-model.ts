import type { PlatformCourse } from "./platform-course-model";

export type AdmissionMode = "direct" | "application" | "invite";
export type RequirementMode = "all" | "any";
export type AdmissionRule = {
  admissionMode: AdmissionMode;
  prerequisiteCourseIds: string[];
  minimumPoints: number;
  requirementMode?: RequirementMode;
  ruleId?: string;
  generation?: string;
  invitation?: { active: boolean; expiresAt: string | null };
};
export type AudiencePolicy = {
  scope: "all" | "custom";
  allRule: AdmissionRule | null;
  independentRule: AdmissionRule | null;
  schoolRules: (AdmissionRule & { schoolId: string })[];
  accountRules: (AdmissionRule & { identityId: string })[];
};
export type LearnerAdmissionRule = {
  ruleId: string;
  generation: string;
  admissionMode: AdmissionMode;
  targetKind?: "all" | "independent" | "school" | "account";
  schoolName?: string;
  schoolId?: string;
  requirementMode?: RequirementMode;
  requirementsMet: boolean;
  granted: boolean;
  applicationStatus: "none" | "pending" | "approved" | "rejected" | "revoked";
  points: { source: "platform"; current: number; required: number };
  prerequisites: { courseId: string; title?: string; available: boolean; canOpen?: boolean; requiresAdmission?: boolean; completed: boolean; readChapters: number; totalChapters: number; completedExercises: number; totalExercises: number }[];
};
export const directAdmissionRule = (): AdmissionRule => ({ admissionMode: "direct", prerequisiteCourseIds: [], minimumPoints: 0, requirementMode: "all" });

/** Older course scopes keep their permissions; no independent group is enabled implicitly. */
export function courseAudiencePolicy(course: Pick<PlatformCourse, "audiencePolicy" | "audienceScope" | "schoolIds" | "studentIds">): AudiencePolicy {
  return course.audiencePolicy ?? {
    scope: course.audienceScope === "all" ? "all" : "custom",
    allRule: course.audienceScope === "all" ? directAdmissionRule() : null,
    independentRule: null,
    schoolRules: course.audienceScope === "schools" ? course.schoolIds.map(schoolId => ({ schoolId, ...directAdmissionRule() })) : [],
    accountRules: course.audienceScope === "students" ? course.studentIds.map(identityId => ({ identityId, ...directAdmissionRule() })) : [],
  };
}
export function admissionRuleSettings(rule: AdmissionRule) {
  return { admissionMode: rule.admissionMode, prerequisiteCourseIds: rule.prerequisiteCourseIds, minimumPoints: rule.minimumPoints, requirementMode: rule.requirementMode ?? "all" };
}
export function activeAdmissionRules(policy: AudiencePolicy): AdmissionRule[] {
  return policy.scope === "all" ? policy.allRule ? [policy.allRule] : []
    : [...(policy.independentRule ? [policy.independentRule] : []), ...policy.schoolRules, ...policy.accountRules];
}
export function courseAudiencePolicyForSave(policy: AudiencePolicy): AudiencePolicy {
  return policy.scope === "all"
    ? { scope: "all", allRule: policy.allRule ?? directAdmissionRule(), independentRule: null, schoolRules: [], accountRules: [] }
    : { ...policy, allRule: null };
}
export function validCourseInvitation(value: string) {
  return /^[A-HJ-KM-NP-Z2-9]{6}$/.test(value);
}
