"use client";

import { useWorkspaceData } from "@/components/workspace-data";
import type { AcslCatalog } from "./model";

export function useAcslEnabled(schoolId?: string, management = false) {
  const catalog = useWorkspaceData<Pick<AcslCatalog, "enabled">>(
    schoolId ? `schools/${schoolId}/acsl${management ? "/manage" : ""}?view=availability` : "",
  );
  return catalog.data?.enabled === true;
}
