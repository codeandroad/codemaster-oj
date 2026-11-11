export const ACSL_WRITTEN_DURATION_MS = 60 * 60 * 1000;

export type AcslWrittenTimerRecord = {
  startedAt: number;
  stoppedAt: number | null;
};

export function acslWrittenTimerKey(
  accountId: string,
  schoolId: string,
  paperId: string,
  versionId: string,
) {
  return `campus-judge:acsl-written-timer:v1:${JSON.stringify([accountId, schoolId, paperId, versionId])}`;
}

const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15;

export function parseAcslWrittenTimer(raw: string | null, now = Infinity): AcslWrittenTimerRecord | null {
  try {
    const saved = JSON.parse(raw ?? "null");
    if (!saved || !timestamp(saved.startedAt) || saved.startedAt > now ||
      (saved.stoppedAt !== null && (!timestamp(saved.stoppedAt) || saved.stoppedAt < saved.startedAt || saved.stoppedAt > now))) return null;
    return { startedAt: saved.startedAt, stoppedAt: saved.stoppedAt };
  } catch {
    return null;
  }
}

/** Tabs converge on the first start and never restart a completed practice. */
export function mergeAcslWrittenTimers(
  ...records: (AcslWrittenTimerRecord | null)[]
): AcslWrittenTimerRecord | null {
  const present = records.filter((record): record is AcslWrittenTimerRecord => record !== null);
  if (!present.length) return null;
  const stops = present.flatMap(record => record.stoppedAt === null ? [] : [record.stoppedAt]);
  return {
    startedAt: Math.min(...present.map(record => record.startedAt)),
    stoppedAt: stops.length ? Math.min(...stops) : null,
  };
}

export function resolveAcslWrittenTimer(
  record: AcslWrittenTimerRecord | null,
  now: number,
  graded: boolean,
  gradedAt: string | null,
): AcslWrittenTimerRecord | null {
  // Opening an old result must not invent a start or a duration.
  if (!record) return graded ? null : { startedAt: now, stoppedAt: null };
  if (!graded || record.stoppedAt !== null) return record;
  const receivedAt = gradedAt ? Date.parse(gradedAt) : NaN;
  // This is a personal practice clock. If client/server clocks differ, freeze
  // at observation instead of displaying a negative or future elapsed time.
  const end = Number.isFinite(receivedAt) && receivedAt >= record.startedAt && receivedAt <= now
    ? receivedAt : now;
  return { startedAt: record.startedAt, stoppedAt: Math.max(record.startedAt, end) };
}

export function acslWrittenTimerReading(record: AcslWrittenTimerRecord, now: number) {
  const elapsedMs = Math.max(0, (record.stoppedAt ?? now) - record.startedAt);
  const remainingSeconds = Math.max(0, Math.ceil((ACSL_WRITTEN_DURATION_MS - elapsedMs) / 1000));
  return {
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    remainingSeconds,
    overTime: elapsedMs > ACSL_WRITTEN_DURATION_MS,
    phase: record.stoppedAt !== null ? "stopped" as const
      : remainingSeconds === 0 ? "expired" as const
        : remainingSeconds <= 300 ? "warning" as const : "running" as const,
  };
}

export function formatAcslWrittenTime(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}
