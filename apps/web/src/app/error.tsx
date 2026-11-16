"use client";

export default function ApplicationError({ retry }: { retry: () => void }) {
  return <main className="mx-auto max-w-lg p-8">
    <h1 className="text-xl font-bold">页面暂时无法显示</h1>
    <p className="mt-3 text-sm text-muted-foreground">若重试后仍无法显示，可以刷新整个页面。</p>
    <div className="mt-5 flex flex-wrap gap-2">
      <button type="button" className="rounded-md bg-primary px-4 py-3 text-primary-foreground" onClick={retry}>重试</button>
      <button type="button" className="rounded-md border border-border px-4 py-3" onClick={() => window.location.reload()}>刷新整个页面</button>
    </div>
  </main>;
}
