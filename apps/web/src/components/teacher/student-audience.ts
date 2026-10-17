export interface AudienceClass { id: string; name: string; canAssociate?: boolean; }
export interface AudienceDirectory { items: AudienceStudent[]; classes: AudienceClass[]; }

export interface AudienceStudent {
  id: string;
  name: string;
  number: string;
  classIds?: string[];
  classNames?: string[];
  activated?: boolean;
  historical?: boolean;
}

export function filterAudienceStudents(students: AudienceStudent[], scope: string, query: string, selectedIds: string[]) {
  const selected = new Set(selectedIds), term = query.trim().toLocaleLowerCase();
  return students.filter(student => (!term || `${student.name} ${student.number}`.toLocaleLowerCase().includes(term)) &&
    (scope === "all" || scope === "selected" && selected.has(student.id) || scope === "unassigned" && !student.historical && !student.classIds?.length || student.classIds?.includes(scope)));
}

export function addAudienceSelection(current: string[], additions: string[], excluded: ReadonlySet<string>, limit = 500) {
  const next = [...new Set([...current, ...additions.filter(id => !excluded.has(id))])];
  if (next.length > limit) throw new Error("AUDIENCE_LIMIT");
  return next;
}

export function audienceClassIds(students: AudienceStudent[], selectedIds: string[], allowedClassIds: string[]) {
  const selected = new Set(selectedIds), allowed = new Set(allowedClassIds);
  return [...new Set(students.filter(student => selected.has(student.id)).flatMap(student => student.classIds ?? []).filter(id => allowed.has(id)))].sort();
}

export function activityAudienceClassIds(students: AudienceStudent[], selectedIds: string[], allowedClassIds: string[], savedClassIds?: string[], savedParticipantIds: string[] = []) {
  const inferred = audienceClassIds(students, selectedIds, allowedClassIds);
  if (!savedClassIds) return inferred;
  const previous = [...new Set(savedClassIds)].sort();
  const unchanged = [...new Set(selectedIds)].sort().join(",") === [...new Set(savedParticipantIds)].sort().join(",");
  return unchanged ? previous : [...new Set([...previous, ...inferred])].sort();
}
