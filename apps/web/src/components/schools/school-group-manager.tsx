"use client";

import { useRef, useState } from "react";
import { Feedback, Loading, Modal, inputClass, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { RowActionButton } from "@/components/ui/row-action";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";
import type { Bank } from "./school-practice-types";

export type SchoolGroup = { id: string; name: string; bankId: string; problemIds: string[]; revision: string };
type Entry = { id: string; title: string };
type Edit = { mode: "edit" | "new" | "move" | "dissolve"; group?: SchoolGroup };

export function SchoolGroupManager({base, bank, onClose, onChanged}: {
  base: string; bank: Bank; onClose: () => void; onChanged: (removed?: string) => void;
}) {
  const t = useSchoolText();
  const path = base + "/problem-groups";
  const resource = useData<{items: SchoolGroup[]; problems: Entry[]}>(path + "?view=manage&bankId=" + bank.id);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState("");
  const requestId = useRef("");
  const action = useMutation();
  const pending = useRef(false);
  const groups = resource.data?.items ?? [];
  const group = edit?.group;
  const moving = edit?.mode === "move";
  const dissolving = edit?.mode === "dissolve";
  const target = groups.find(row => row.id === targetId);
  const sourceIds = new Set(group?.problemIds);
  const entries = (resource.data?.problems ?? []).filter(row => (!moving || sourceIds.has(row.id))
    && (row.title + " " + row.id).toLowerCase().includes(query.trim().toLowerCase()));

  function start(next: Edit) {
    requestId.current = crypto.randomUUID();
    setName(next.group?.name ?? "");
    setSelected(new Set(next.mode === "edit" ? next.group?.problemIds : []));
    setQuery(""); setTargetId(""); action.clear(); setEdit(next);
  }
  function toggle(ids: string[], add: boolean) {
    setSelected(current => {
      const next = new Set(current);
      for (const id of ids) { if (add) next.add(id); else next.delete(id); }
      return next;
    });
  }
  async function save() {
    if (!edit || pending.current) return;
    pending.current = true;
    try {
      await action.run(async () => {
        const endpoint = group ? path + "/" + group.id : path;
        if (group && dissolving) await productionApi(endpoint, {method:"DELETE", body:{expectedRevision:group.revision}});
        else if (group && moving && target) await productionApi(endpoint + "/move", {method:"POST", body:{
          expectedRevision:group.revision, targetGroupId:target.id, targetRevision:target.revision, problemIds:[...selected],
        }});
        else await productionApi(endpoint, {method: group ? "PATCH" : "POST", body:{
          name:name.trim(), problemIds:[...selected], ...(group ? {expectedRevision:group.revision} : {bankId:bank.id, requestId:requestId.current}),
        }});
        setEdit(null); resource.reload(); onChanged(dissolving ? group?.id : undefined);
      });
    } finally { pending.current = false; }
  }
  const submit = dissolving ? t("Confirm dissolution","确认解散") : moving ? t("Move selected","移动所选题目") : t("Save group","保存分组");
  return <Modal wide title={t("Manage groups","分组管理")} description={bank.name} onClose={() => { if (!pending.current) onClose(); }}>
    <Loading resource={resource}>{!edit ? <div className="space-y-2">
      {bank.canManage && <Button size="sm" onClick={() => start({mode:"new"})}>{t("New group","新建分组")}</Button>}
      <ul className="max-h-[50vh] divide-y divide-border overflow-auto">{groups.map(row => <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
        <span className="mr-auto">{row.name} <small className="text-muted-foreground">({row.problemIds.length})</small></span>
        <RowActionButton onClick={() => start({mode:"edit",group:row})}>{t("Edit group","编辑分组")}</RowActionButton>
        <RowActionButton disabled={!row.problemIds.length || groups.length < 2} onClick={() => start({mode:"move",group:row})}>{t("Move problems","移动题目")}</RowActionButton>
        <RowActionButton onClick={() => start({mode:"dissolve",group:row})}>{t("Dissolve","解散")}</RowActionButton>
      </li>)}</ul>
      {!groups.length && <p className="text-sm text-muted-foreground">{t("This bank has no groups yet.","该题库暂无分组。")}</p>}
    </div> : <form className="space-y-3" onSubmit={e => {e.preventDefault(); void save();}}>
      <fieldset disabled={action.busy} className="space-y-3">
        {dissolving ? <p>{t(`Dissolve “${name}”? Problems, other groups and submission history will be kept.`,`解散「${name}」？题目、其他分组和提交记录都会保留。`)}</p> : <>
          {moving ? <label className="block text-sm">{t("Move from " + name + " to", "从「" + name + "」移至")}
            <select required className={inputClass} value={targetId} onChange={e => setTargetId(e.target.value)}>
              <option value="">{t("Select a group","选择目标分组")}</option>
              {groups.filter(row => row.id !== group?.id).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select></label> : <label className="block text-sm">{t("Group name","分组名称")}
            <input required maxLength={200} className={inputClass} value={name} onChange={e => setName(e.target.value)}/></label>}
          <input aria-label={t("Search problems","搜索题目")} placeholder={t("Search title or ID","搜索题目标题或编号")} type="search" className={inputClass} value={query} onChange={e => setQuery(e.target.value)}/>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!entries.length}
            checked={entries.length > 0 && entries.every(row => selected.has(row.id))}
            onChange={e => toggle(entries.map(row => row.id),e.target.checked)}/>{t("Select all matches","全选匹配题目")} · {t(`${selected.size} selected`,`已选 ${selected.size} 道`)}</label>
          <div className="max-h-[32vh] divide-y divide-border overflow-auto rounded-md border border-border">
            {entries.map(row => <label key={row.id} className="flex items-center gap-2 px-3 py-2 text-sm"><input type="checkbox" checked={selected.has(row.id)}
              onChange={e => toggle([row.id],e.target.checked)}/>{row.title}</label>)}
            {!entries.length && <p className="p-2 text-sm">{t("No matching problems.","没有匹配的题目。")}</p>}
          </div>
        </>}
        <Feedback action={action}/>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => {setEdit(null); resource.reload();}}>{t("Cancel","取消")}</Button>
          <Button type="submit" variant={dissolving ? "danger" : "primary"} disabled={moving ? !target || !selected.size : !name.trim()}>{submit}</Button></div>
      </fieldset>
    </form>}</Loading>
  </Modal>;
}
