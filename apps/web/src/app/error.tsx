"use client";

export default function ApplicationError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-lg p-8"><h1 className="text-xl font-bold">页面暂时无法显示</h1><p className="mt-3 text-sm text-muted-foreground">请重新加载页面。若问题持续，请联系学校管理员。</p><button className="mt-5 rounded-md bg-primary px-4 py-3 text-primary-foreground" onClick={reset}>重新加载</button></main>;
}
