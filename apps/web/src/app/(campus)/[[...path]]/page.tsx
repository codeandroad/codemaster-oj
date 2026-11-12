import { notFound } from "next/navigation";
import { isCampusRoute } from "@/lib/campus-routes";

export const dynamic = "force-dynamic";

export default async function CampusPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const pathname = `/${path.join("/")}`;
  if (!isCampusRoute(pathname)) notFound();
  return null;
}
