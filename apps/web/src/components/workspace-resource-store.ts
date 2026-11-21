import { ApiConnectionError, apiConnectionMessage } from "../lib/production-api.ts";

export type WorkspaceResourceSnapshot = {
  data: unknown | null;
  loading: boolean;
  error: string;
  connectionError: boolean;
};
type Entry = {
  snapshot: WorkspaceResourceSnapshot;
  listeners: Set<() => void>;
  request?: Promise<void>;
  controller?: AbortController;
  timeout?: ReturnType<typeof setTimeout>;
};

const workspaceRequestTimeoutMs = 15_000;

export const emptyWorkspaceResource: WorkspaceResourceSnapshot = {
  data: null,
  loading: false,
  error: "",
  connectionError: false,
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
  function releaseRequest(value: Entry) {
    clearTimeout(value.timeout);
    value.timeout = undefined;
    value.controller = undefined;
    value.request = undefined;
  }
  function cancelRequest(value: Entry) {
    value.controller?.abort();
    releaseRequest(value);
  }
  function clear(error = "") {
    for (const value of entries.values()) {
      cancelRequest(value);
      publish(value, { ...emptyWorkspaceResource, error });
    }
  }
  function pruneSchools(data: unknown) {
    const schools = data as { items?: { id: string; roles: string[] }[] };
    if (!Array.isArray(schools?.items)) return;
    for (const [path, value] of entries) {
      const match = /^schools\/([^/]+)\/acsl(\/manage)?(?:\?view=availability)?$/.exec(path);
      if (!match) continue;
      const school = schools.items.find(item => item.id === match[1]);
      const canManage = school?.roles.some(role => ["school_admin", "teacher", "admin"].includes(role));
      if (school && (!match[2] || canManage)) continue;
      cancelRequest(value);
      publish(value, emptyWorkspaceResource);
    }
  }
  function load(path: string): Promise<void> {
    if (!path) return Promise.resolve();
    const value = entry(path);
    if (value.request) return value.request;
    const controller = new AbortController();
    value.controller = controller;
    value.timeout = setTimeout(() => {
      cancelRequest(value);
      publish(value, {
        ...value.snapshot,
        loading: false,
        error: apiConnectionMessage,
        connectionError: true,
      });
    }, workspaceRequestTimeoutMs);
    // Schedule the fetch after storing its promise so concurrent consumers share it.
    const request = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return fetchResource(path, controller.signal);
    })
      .then(data => {
        if (controller.signal.aborted || value.controller !== controller) return;
        if (path === "schools") pruneSchools(data);
        publish(value, { ...emptyWorkspaceResource, data });
      })
      .catch(reason => {
        if (controller.signal.aborted || value.controller !== controller) return;
        const status = typeof reason === "object" && reason !== null && "status" in reason ? reason.status : null;
        if (status === 401) { clear(errorMessage(reason)); return; }
        const connectionError = reason instanceof ApiConnectionError || status === 502 || status === 503 || status === 504;
        publish(value, {
          data: status === 403 || status === 404 ? null : value.snapshot.data,
          loading: false,
          error: connectionError ? apiConnectionMessage : errorMessage(reason),
          connectionError,
        });
      })
      .finally(() => {
        if (value.controller !== controller) return;
        releaseRequest(value);
      });
    value.request = request;
    publish(value, { ...value.snapshot, loading: value.snapshot.data === null, error: "", connectionError: false });
    return request;
  }
  function refresh(path: string) {
    const value = entries.get(path);
    if (!value) return;
    cancelRequest(value);
    return load(path);
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
    refresh,
    refreshObserved() {
      for (const [path, value] of entries) if (value.listeners.size) void load(path);
    },
    recoverObserved() {
      for (const [path, value] of entries) {
        if (value.listeners.size && (value.request || value.snapshot.connectionError)) void refresh(path);
      }
    },
    clear,
  };
}
