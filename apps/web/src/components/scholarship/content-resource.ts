"use client";

import { useEffect, useState } from "react";
import { apiMessage, productionApi } from "@/lib/production-api";
import type { ContentResponse } from "./content-model";

/** Keep the form mounted during refresh, and never apply recommendations from an older request. */
export function useContentResource(path: string) {
  const [resource, setResource] = useState<{ path: string; data: ContentResponse } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    productionApi<ContentResponse>(path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResource({ path, data }); })
      .catch(cause => { if (!controller.signal.aborted) setError(apiMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return {
    data: resource?.data ?? null,
    loading: loading || (resource?.path !== path && !error),
    error,
    reload: () => setRevision(value => value + 1),
    setData: (update: (previous: ContentResponse | null) => ContentResponse) => setResource(previous => ({
      path: previous?.path ?? path, data: update(previous?.data ?? null),
    })),
  };
}
