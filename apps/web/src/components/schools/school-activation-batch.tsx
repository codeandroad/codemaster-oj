"use client";

import { useRef, useState } from "react";
import { CopyCode, Loading, Modal, useData } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { ApiError, productionApi } from "@/lib/production-api";
import { SchoolClassFilter, useSchoolDirectoryOptions } from "./school-directory-filters";
import { IdentityFilter } from "./school-administration";
import { RoleLabel, useSchoolError, useSchoolText, type School } from "./school-ui";

type Person = { kind: "student" | "teacher"; number: string; name: string };
type IssueResult = {
  school: { slug: string; name: string };
  items: { person: Person; activationCode: string }[];
};

export function SchoolActivationBatch({ school, onClose }: { school: School; onClose: () => void }) {
  const text = useSchoolText();
  const explain = useSchoolError();
  const [kind, setKind] = useState<Person["kind"] | "">("");
  const [classId,setClassId] = useState("");
  const options = useSchoolDirectoryOptions(school.id);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState(new Set<string>());
  const [result, setResult] = useState<IssueResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const issuing = useRef(false);
  const params = new URLSearchParams({ pendingActivation: "true", page: String(page), q: query });
  if (classId) params.set("classId",classId);
  if (kind) params.set("kind", kind);
  const path = `schools/${school.id}/identities`;
  const resource = useData<{ items: (Person & { id: string; classes:{id:string;name:string;archived:boolean}[] })[]; hasMore: boolean }>(result ? null : `${path}?${params}`);
  const rows = !resource.pending && !resource.error ? resource.data?.items ?? [] : [];
  const all = rows.length > 0 && rows.every(row => selection.has(row.id));
  const some = rows.some(row => selection.has(row.id));
  const limit = 500;

  function select(ids: string[], checked: boolean) {
    const next = new Set(selection);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    if (next.size > limit) {
      setError(text("Select up to 500 identities per batch.", "每次最多选择 500 个身份。"));
      return;
    }
    setError("");
    setSelection(next);
  }

  function resetFilter() {
    setPage(1);
    setSelection(new Set());
    setError("");
  }

  async function issue() {
    if (issuing.current || !selection.size) return;
    issuing.current = true;
    setBusy(true);
    setError("");
    try {
      setResult(await productionApi<IssueResult>(`${path}/activation-batch`, {
        method: "POST", body: { identityIds: [...selection] },
      }));
    } catch (cause) {
      if (cause instanceof ApiError && [404, 409].includes(cause.status)) {
        setSelection(new Set());
        resource.reload();
        setError(text("The list has changed. No codes were issued. Select the identities again.", "名单已变化，本批未签发。请重新勾选身份。"));
      } else setError(explain(cause).message);
    } finally {
      issuing.current = false;
      setBusy(false);
    }
  }

  const details = result ? result.items.map(({ person, activationCode }) => [
    text("School code", "学校标识") + " " + result.school.slug,
    person.kind === "student" ? text("Student ID", "学号") + " " + person.number : text("Staff ID", "工号") + " " + person.number,
    text("Name", "姓名") + " " + person.name,
    text("Identity claim code", "认领码") + " " + activationCode,
  ].join("\n")) : [];
  const close = () => { if (!issuing.current) onClose(); };

  return <Modal wide title={text("Generate claim codes", "批量生成认领码")} onClose={close}
    description={result
      ? text("Give each person their own code privately. Use Claim an identity or apply to join after signing in. Copy the codes before closing.", "请将认领信息分别私下交给本人，登录后进入“设置 → 学校”，选择“加入学校”。关闭前请复制留存。")
      : text(`Select unlinked identities at ${school.name}. Each code works once for seven days. Issuing a new code replaces the previous one.`,
          `请选择${school.name}待认领的身份。每人一码，有效期七天。重新签发后，该身份的旧码立即失效。`)}>
    {result ? <>
      <div className="max-h-[48vh] divide-y divide-border overflow-auto">
        {result.items.map(({ person, activationCode }, index) => <div key={activationCode} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <div><span className="font-semibold">{person.name}</span> · <RoleLabel role={person.kind} /> · {person.number}
            <code className="block select-all break-all">{activationCode}</code></div>
          <CopyCode text={details[index]} label={text("Copy details", "复制认领信息")} />
        </div>)}
      </div>
      <div className="flex items-center justify-end gap-2">
        <CopyCode text={details.join("\n\n")} label={text("Copy all", "复制全部")} />
        <Button onClick={close}>{text("Done, close", "已记录，关闭")}</Button>
      </div>
    </> : <>
      <fieldset disabled={busy} className="min-w-0 space-y-2">
        <IdentityFilter kind={kind}
          onKind={next => { if (next !== kind) { setKind(next); resetFilter(); } }}
          onQuery={next => { if (next !== query) { setQuery(next); resetFilter(); } }} />
        <SchoolClassFilter classes={options.data?.classes ?? []} value={classId} onChange={next=>{setClassId(next); resetFilter();}}/>
        {options.error && <p role="alert">{options.error}</p>}
        <Loading resource={{ ...resource, loading: resource.pending || resource.loading }}>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" disabled={!rows.length} checked={all}
              ref={element => { if (element) element.indeterminate = some && !all; }}
              onChange={e => select(rows.map(row => row.id), e.target.checked)} />
            {text("Select this page", "全选本页")}
          </label>
          <div className="max-h-[36vh] overflow-auto border-y border-border">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="sticky top-0 bg-surface-subtle"><tr>{[text("Select","选择"),text("ID","编号"),text("Name","姓名"),text("Type","类型"),text("Class","班级")].map(title=><th scope="col" key={title} className="p-2">{title}</th>)}</tr></thead>
              <tbody>{rows.map(row=><tr key={row.id} className="border-t border-border">
                <td className="p-2"><input type="checkbox" aria-label={text("Select "+row.name,"选择 "+row.name)} checked={selection.has(row.id)} onChange={e=>select([row.id],e.target.checked)}/></td>
                <td className="p-2 font-mono">{row.number}</td><td className="p-2 font-semibold">{row.name}</td>
                <td className="p-2"><RoleLabel role={row.kind}/></td><td className="p-2">{row.classes.filter(c=>!c.archived).map(c=>c.name).join("、")||"—"}</td>
              </tr>)}</tbody>
            </table>
            {!rows.length && <p className="py-4 text-sm text-muted-foreground">{text("No unlinked identities match.", "没有符合条件的待认领身份。")}</p>}
          </div>
          <div className="flex items-center justify-end gap-2 py-1 text-sm">
            <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>{text("Previous", "上一页")}</Button>
            {text(`Page ${page}`, `第 ${page} 页`)}
            <Button size="sm" variant="secondary" disabled={!resource.data?.hasMore} onClick={() => setPage(page + 1)}>{text("Next", "下一页")}</Button>
          </div>
        </Loading>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="status" className="text-sm">{text(`${selection.size} selected`, `已选 ${selection.size} 人`)}</span>
        <Button disabled={busy || !selection.size || resource.pending || Boolean(resource.error)} onClick={() => void issue()}>
          {text(busy ? "Generating…" : "Generate codes", busy ? "正在生成…" : "生成认领码")}
        </Button>
      </div>
    </>}
  </Modal>;
}
