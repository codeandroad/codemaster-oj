import type { AudiencePolicy } from "./platform-course-admission-model";
import type { CourseSection } from "@/components/course-sections";
import type { SubmissionLanguage } from "@/lib/production-api";
import type { CourseLocalizations, ChapterLocalizations } from "@/components/course-localization";
import type { CourseAcslLink } from "@/components/course-acsl";

export type CourseAudience = "all" | "schools" | "students";
export type AudienceMember = { id: string; name: string; username?: string | null };
export type PlatformChapter = {
  sectionKey?: string | null; id?: string; title: string; content: string; problemCount?: number;
  objective?: string; checkpoint?: string; checkpointAnswer?: string;
  localizations?: ChapterLocalizations; acslLinks?: CourseAcslLink[];
};
export type PlatformCourse = {
  audiencePolicy?: AudiencePolicy;
  pendingApplications?: number;
  sections?: CourseSection[];
  localizations?: CourseLocalizations;
  id: string; title: string; description: string; category: string; authorName: string;
  estimatedMinutes: number; requiredLanguage: SubmissionLanguage | null;
  revision: number; sourceVersion: string; published: boolean; archived: boolean;
  audienceScope: CourseAudience; schoolIds: string[]; studentIds: string[];
  schools: AudienceMember[]; students: AudienceMember[]; chapterCount: number; chapters: PlatformChapter[];
};
