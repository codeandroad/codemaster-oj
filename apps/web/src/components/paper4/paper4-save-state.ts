export interface Paper4SaveState {
  saved: Record<string, string>;
  pending: string[];
  errors: Record<string, string>;
}

type Paper4SaveAction =
  | { type: "start"; key: string }
  | { type: "acknowledge"; key: string; content: string }
  | { type: "fail"; key: string; message: string }
  | { type: "settle"; key: string };

export function createPaper4SaveState(saved: Record<string, string>): Paper4SaveState {
  return { saved: { ...saved }, pending: [], errors: {} };
}

export function paper4SaveReducer(state: Paper4SaveState, action: Paper4SaveAction): Paper4SaveState {
  switch (action.type) {
    case "start": {
      const errors = { ...state.errors };
      delete errors[action.key];
      return { ...state, errors, pending: state.pending.includes(action.key) ? state.pending : [...state.pending, action.key] };
    }
    case "acknowledge":
      return { ...state, saved: { ...state.saved, [action.key]: action.content } };
    case "fail":
      return { ...state, errors: { ...state.errors, [action.key]: action.message } };
    case "settle":
      return { ...state, pending: state.pending.filter(key => key !== action.key) };
  }
}

/** Both the status label and navigation protection describe the whole paper. */
export function paper4SaveSummary(codes: Record<string, string>, state: Paper4SaveState) {
  // A pending write or a lost response may have replaced server content even
  // if the student has reverted the editor to its previously saved value.
  const hasErrors = Object.keys(state.errors).length > 0;
  const dirty = hasErrors || state.pending.length > 0 || Object.keys(codes).some(key => codes[key] !== state.saved[key]);
  const status: "saved" | "saving" | "error" = hasErrors ? "error" : dirty ? "saving" : "saved";
  return { dirty, status };
}
