import Link from "next/link";

export default function NotFound() {
  return <main className="mx-auto max-w-lg p-8"><h1 className="text-xl font-bold">页面不存在</h1><p className="mt-3 text-sm text-muted-foreground">请检查链接，或回到工作台继续学习。</p><Link href="/" className="mt-5 inline-flex rounded-md bg-primary px-4 py-3 text-primary-foreground">返回工作台</Link></main>;
}
