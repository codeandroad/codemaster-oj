import { localizedFields } from './course-localizations.mjs';

export function courseEntry(listing, course, admission) {
  return {
    sections:course.sections??[],...localizedFields(course.localizations),id: listing.id,
    title: course.title,
    description: course.description,
    chapterCount: course.chapter_count,
    sourceSchool: course.school_name,
    ownerScope: listing.platform_owned?'platform':'school',
    category: course.category,
    difficulty: course.difficulty,
    coverKey: course.cover_key,
    coverImage: course.cover_image ?? null,
    authorName: course.author_name ?? '',
    authoredAt: course.authored_at,
    revision: course.revision,
    requiredLanguage: course.required_language ?? null,
    accessScope: course.access_scope,
    admission,
    ...(listing.platform_owned?{admissionRules:course.admissionRules??[]}:{}),
  };
}

