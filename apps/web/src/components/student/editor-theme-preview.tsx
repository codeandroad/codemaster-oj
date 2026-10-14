"use client";
import type {CSSProperties} from 'react';
import {editorTheme,type EditorTheme} from './editor-themes';
import {CodeTokens} from './code-editor';
const sample='# 返回两个数的和\ndef solve(a: int, b: int):\n    message = "Hello, CodeMaster"\n    values = [1, 2, 3]\n    print(message)\n    return a + b';
export function EditorThemePreview({theme}:{theme:EditorTheme}){const selected=editorTheme(theme);return <section aria-label="编辑器配色预览" data-od-id="editor-theme-preview" className="my-3"><div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>配色预览 · {selected.label}</span><span>Python</span></div><div style={{...selected.tokens,background:'var(--code)',color:'var(--code-foreground)'} as CSSProperties} className="overflow-x-auto rounded-md border border-border p-3" data-preview-theme={theme}><pre className="text-xs leading-6 font-mono"><CodeTokens code={sample} language="python"/></pre></div><p className="mt-2 text-xs text-muted-foreground">仅应用于代码编辑区；页面主题保持独立。</p></section>;}
