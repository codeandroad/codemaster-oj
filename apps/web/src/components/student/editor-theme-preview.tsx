"use client";
import type {CSSProperties} from 'react';
import {useLocale} from '@/components/locale-context';
import {editorTheme,type EditorTheme} from './editor-themes';
import {CodeTokens} from './code-editor';
const sample='# 返回两个数的和\ndef solve(a: int, b: int):\n    message = "Hello, CodeMaster"\n    values = [1, 2, 3]\n    print(message)\n    return a + b';
const sampleEnglish='# Return the sum of two numbers\ndef solve(a: int, b: int):\n    message = "Hello, CodeMaster"\n    values = [1, 2, 3]\n    print(message)\n    return a + b';
export function EditorThemePreview({theme}:{theme:EditorTheme}){const {locale}=useLocale();const selected=editorTheme(theme);return <section aria-label={locale==='en'?'Editor theme preview':'编辑器配色预览'} data-od-id="editor-theme-preview" className="my-3"><div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{locale==='en'?'Theme preview':'配色预览'} · {selected.label}</span><span>Python</span></div><div style={{...selected.tokens,background:'var(--code)',color:'var(--code-foreground)'} as CSSProperties} className="overflow-x-auto rounded-md border border-border p-3" data-preview-theme={theme}><pre className="text-xs leading-6 font-mono"><CodeTokens code={locale==='en'?sampleEnglish:sample} language="python"/></pre></div><p className="mt-2 text-xs text-muted-foreground">{locale==='en'?'Applies only to the code editor. The page theme is separate.':'仅应用于代码编辑区；页面主题保持独立。'}</p></section>;}
