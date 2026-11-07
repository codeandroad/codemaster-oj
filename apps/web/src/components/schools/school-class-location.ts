type Search = Pick<URLSearchParams, "get" | "toString">;

export function schoolClassLocation(search: Search) {
  const rawPage = Number(search.get("classPage") ?? 1);
  return {
    page: Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000 ? rawPage : 1,
    archived: search.get("classArchived") === "true",
    classId: search.get("classId") ?? "",
  };
}

export function schoolClassHref(search: Search, schoolId: string, change: {
  page?: number; archived?: boolean; classId?: string;
}) {
  const params = new URLSearchParams(search.toString());
  params.set("schoolId", schoolId);
  params.set("section", "classes");
  if (change.page !== undefined) params.set("classPage", String(change.page));
  if (change.archived !== undefined) params.set("classArchived", String(change.archived));
  if (change.classId !== undefined) {
    if (change.classId) params.set("classId", change.classId);
    else params.delete("classId");
  }
  return `/schools?${params}`;
}
