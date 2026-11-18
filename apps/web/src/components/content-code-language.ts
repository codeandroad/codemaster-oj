import type { SubmissionLanguage } from '@/lib/production-api';

/** Only known fence languages receive syntax highlighting; other fences stay literal. */
export function contentCodeLanguage(language?: string): SubmissionLanguage | undefined {
  switch (language?.trim().toLowerCase()) {
    case 'python': case 'py': case 'python3': return 'python';
    case 'cpp': case 'c++': case 'cxx': return 'cpp';
    case 'javascript': case 'js': return 'javascript';
    default: return undefined;
  }
}
