import { liveProblemVersionIdSql } from './live-problem-version.mjs';

// Courses use the same current teaching definition as every other activity.
// The caller still enforces the course's school-public approval requirements.
export const latestCourseProblemVersion = `LEFT JOIN LATERAL (
 SELECT ${liveProblemVersionIdSql('p')} id
) latest ON`;
