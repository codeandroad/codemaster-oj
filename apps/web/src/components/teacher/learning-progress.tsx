"use client";

import { useLocale } from "@/components/locale-context";
import { Modal, State, Table, useData, Empty } from "./shared";

export function LearningProgressDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const resource = useData<{
    chapterCount: number;
    taskCount: number;
    items: { id: string; name: string; number: string; completedChapters: number; completedTasks: number }[];
  }>(`learning-paths/${id}/progress`);
  return <Modal title={tr("章节阅读与练习完成进度", "Chapter and practice progress")} wide onClose={onClose}>
    <p className="mb-4 text-sm text-muted-foreground">{tr("仅展示你负责班级内的学生；管理员可查看全校。阅读与正式判题通过分别统计。", "Teachers see students in their assigned classes; administrators can see the whole school. Reading and formal ACs are counted separately.")}</p>
    <State resource={resource} />
    {resource.data && <div data-od-id="learning-progress-table" className="max-h-[55dvh] min-w-0 overflow-auto rounded-md border border-border [&_thead]:sticky [&_thead]:top-0 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
      <Table min={560} headers={[tr("学生", "Student"), tr("编号", "ID"), tr("章节已读", "Chapters read"), tr("练习通过", "Practices passed")]}>
        {resource.data.items.map(student => <tr key={student.id}>
          <td>{student.name}</td><td>{student.number}</td>
          <td>{student.completedChapters} / {resource.data!.chapterCount}</td>
          <td>{resource.data!.taskCount ? `${student.completedTasks} / ${resource.data!.taskCount}` : tr("暂无已发布练习", "No published practices")}</td>
        </tr>)}
        {!resource.data.items.length && <Empty columns={4}>{tr("暂无负责班级中的学生。", "No students in assigned classes.")}</Empty>}
      </Table>
    </div>}
  </Modal>;
}
