export const courseIsLive = `p.published_at IS NOT NULL AND p.archived_at IS NULL AND p.withdrawn_at IS NULL
  AND p.listed AND (p.available_from IS NULL OR p.available_from<=now())
  AND (p.available_until IS NULL OR p.available_until>now())`;
