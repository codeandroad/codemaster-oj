interface EntryRequest<T> {
  existing: () => Promise<T>;
  start: () => Promise<T>;
  missing: (reason: unknown) => boolean;
}

export function createPaper4EntryLoader<T>() {
  const inflight = new Map<string, Promise<T>>();
  return function open(key: string, request: EntryRequest<T>): Promise<T> {
    const previous = inflight.get(key);
    if (previous) return previous;
    const pending = request.existing().catch(reason => {
      if (!request.missing(reason)) throw reason;
      return request.start();
    });
    inflight.set(key, pending);
    const finish = () => { if (inflight.get(key) === pending) inflight.delete(key); };
    void pending.then(finish, finish);
    return pending;
  };
}
