export type WorkspaceResourceSnapshot = {
  data: unknown | null;
  loading: boolean;
  error: string;
};
type Entry = {
  snapshot: WorkspaceResourceSnapshot;
  listeners: Set<() => void>;
  request?: Promise<void>;
  controller?: AbortController;
};

export const emptyWorkspaceResource: WorkspaceResourceSnapshot = {
  data: null,
  loading: false,
  error: "",
};
const initialResource: WorkspaceResourceSnapshot = {
  ...emptyWorkspaceResource,
  loading: true,
};

/** Owned by one authenticated React tree, never by browser storage or the server. */
export function createWorkspaceResourceStore(
  fetchResource: (path: string, signal: AbortSignal) => Promise<unknown>,
  errorMessage: (error: unknown) => string,
) {
  const entries = new Map<string, Entry>();
  function entry(path: string) {
    let value = entries.get(path);
    if (!value) {
      value = { snapshot: initialResource, listeners: new Set() };
      entries.set(path, value);
    }
    return value;
  }
  function publish(value: Entry, snapshot: WorkspaceResourceSnapshot) {
    value.snapshot = snapshot;
    for (const listener of value.listeners) listener();
  }
  function clear(error = "") {
    for (const value of entries.values()) {
      value.controller?.abort();
      value.controller = undefined;
      value.request = undefined;
      publish(value, { data: null, loading: false, error });
    }
  }
  function pruneSchools(data: unknown) {
    const schools = data as { items?: { id: string; roles: string[]; legacy?: boolean }[] };
    if (!Array.isArray(schools.items)) return;
    for (const [path, value] of entries) {
      const match = /^schools\/([^/]+)\/acsl(\/manage)?(?:\?view=availability)?$/.exec(path);
      if (!match) continue;
      const school = schools.items.find(item => item.id === match[1]);
      const canManage = school?.roles.some(role => ["school_admin", "teacher", "admin"].includes(role));
      if (school && (!match[2] || canManage)) continue;
      value.controller?.abort();
      value.controller = undefined;
      value.request = undefined;
      publish(value, { data: null, loading: false, error: "" });
    }
  }
  function load(path: string): Promise<void> {
    if (!path) return Promise.resolve();
    const value = entry(path);
    if (value.request) return value.request;
    const controller = new AbortController();
    value.controller = controller;
    publish(value, { ...value.snapshot, loading: value.snapshot.data === null, error: "" });
    // Schedule the fetch after storing its promise so concurrent consumers share it.
    const request = Promise.resolve().then(() => fetchResource(path, controller.signal))
      .then(data => {
        if (controller.signal.aborted || value.controller !== controller) return;
        if (path === "schools") pruneSchools(data);
        publish(value, { data, loading: false, error: "" });
      })
      .catch(reason => {
        if (controller.signal.aborted || value.controller !== controller) return;
        const status = typeof reason === "object" && reason !== null && "status" in reason ? reason.status : null;
        if (status === 401) { clear(errorMessage(reason)); return; }
        publish(value, {
          data: status === 403 || status === 404 ? null : value.snapshot.data,
          loading: false,
          error: errorMessage(reason),
        });
      })
      .finally(() => {
        if (value.controller !== controller) return;
        value.controller = undefined;
        value.request = undefined;
      });
    value.request = request;
    return request;
  }
  return {
    snapshot: (path: string) => path ? entry(path).snapshot : emptyWorkspaceResource,
    subscribe(path: string, listener: () => void) {
      if (!path) return () => undefined;
      const value = entry(path);
      value.listeners.add(listener);
      return () => { value.listeners.delete(listener); };
    },
    load,
    refreshObserved() {
      for (const [path, value] of entries) if (value.listeners.size) void load(path);
    },
    clear,
  };
}
