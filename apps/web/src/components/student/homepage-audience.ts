import type { SchoolRole } from '../schools/school-ui';

export type HomepageAudience = {
  base: string;
  schoolId: string | null;
  name?: string;
  nameZh?: string | null;
  nameEn?: string | null;
  role?: SchoolRole;
};

export function audienceName(book: HomepageAudience, locale: string) {
  return book.schoolId
    ? (locale === 'en' ? book.nameEn || book.nameZh : book.nameZh || book.nameEn) || book.name
    : locale === 'en'
      ? 'Public practice'
      : '公开练习';
}
