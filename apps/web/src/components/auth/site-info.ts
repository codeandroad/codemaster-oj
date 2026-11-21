"use client";
import { useEffect, useState } from "react";
import { productionApi } from "@/lib/production-api";
export function usePublicSite() {
  const [site, setSite] = useState({ siteName: "CodeMaster" });
  useEffect(() => { const controller = new AbortController(); productionApi<{ siteName: string }>("site-info", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setSite(value); }).catch(() => { /* Keep the configured first-render branding if the service is unavailable. */ }); return () => controller.abort(); }, []);
  return site;
}
