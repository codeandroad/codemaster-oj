import type { AcslDraft } from "./model";

type SavedAnswer = AcslDraft & { requiresReview: boolean };
export type AcslAnswerSaveState = {
  selected: string[];
  draft: AcslDraft;
  saving: boolean;
  pending: boolean;
  error: unknown | null;
  conflict: boolean;
};

function sameAnswer(left: string[], right: string[]) {
  return left.length === right.length && left.every(option => right.includes(option));
}

/** Keep one versioned write in flight while retaining the student's latest choice. */
export function createAcslAnswerSaveQueue(initial: AcslDraft, options: {
  send: (selected: string[], revision: number, signal: AbortSignal) => Promise<SavedAnswer>;
  onState: (state: AcslAnswerSaveState) => void;
  onSaved: (answer: SavedAnswer) => void;
}) {
  let draft = { ...initial, selectedOptionIds: [...initial.selectedOptionIds] };
  let selected = [...initial.selectedOptionIds];
  let saving = false, active = true, force = false, generation = 0;
  let error: unknown | null = null;
  let request: Promise<void> | null = null;
  let controller: AbortController | null = null;

  function snapshot(): AcslAnswerSaveState {
    return { selected: [...selected], draft, saving,
      pending: saving || !sameAnswer(selected, draft.selectedOptionIds) || error !== null,
      error, conflict: typeof error === "object" && error !== null && "status" in error && error.status === 409 };
  }
  function publish() { if (active) options.onState(snapshot()); }
  function flush() {
    if (request || !active) return request ?? Promise.resolve();
    if (!force && sameAnswer(selected, draft.selectedOptionIds)) { publish(); return Promise.resolve(); }
    saving = true;
    const currentGeneration = generation;
    publish();
    // Store the promise before starting so synchronous user events share one writer.
    request = Promise.resolve().then(async () => {
      try {
        while (active && currentGeneration === generation && (force || !sameAnswer(selected, draft.selectedOptionIds))) {
          force = false;
          const next = [...selected];
          controller = new AbortController();
          const saved = await options.send(next, draft.revision, controller.signal);
          if (!active || currentGeneration !== generation) return;
          draft = { revision: saved.revision, selectedOptionIds: [...saved.selectedOptionIds] };
          // A slower acknowledgement must never replace choices made after it.
          options.onSaved(saved);
          publish();
        }
      } catch (reason) {
        if (active && currentGeneration === generation) error = reason;
      } finally {
        if (currentGeneration === generation) {
          request = null; controller = null; saving = false; publish();
        }
      }
    });
    return request;
  }
  return {
    snapshot,
    select(next: string[]) {
      if (!active || snapshot().conflict) return Promise.resolve();
      force ||= error !== null;
      selected = [...next]; error = null; publish();
      return flush();
    },
    retry() {
      if (!active || saving || snapshot().conflict) return request ?? Promise.resolve();
      error = null; force = true; return flush();
    },
    activate() { active = true; },
    dispose() {
      active = false; generation++; controller?.abort();
      controller = null; request = null; saving = false;
    },
  };
}
