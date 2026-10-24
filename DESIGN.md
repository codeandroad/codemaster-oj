---
version: alpha
name: CodeMaster OJ
description: "Compact school programming workspace with independently themed assistance code."
colors:
  primary: "oklch(50% .17 255)"
  background: "oklch(96.5% .002 240)"
  surface: "oklch(100% 0 0)"
  foreground: "oklch(18% .012 250)"
  border: "oklch(92% .005 250)"
typography:
  sans:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", system-ui, sans-serif'
  mono:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
rounded:
  DEFAULT: "0.5rem"
omitted:
  - section: spacing
    reason: "Existing layout utilities remain authoritative; no global spacing change in this task."
---
# CodeMaster OJ design context

## Overview

Authenticated school programming tool. Preserve the compact teaching/workspace layout established by the user: the statement and editor carry the content; no new hero cards, decorative banners, or large headings. Chinese and English UI use the existing locale provider; paid translations are versioned assistance, never an effect of switching UI language.

## Colors

Runtime owner: `apps/web/src/app/globals.css`; its `:root` / `.dark` semantic variables map through `@theme inline` to utility classes. Values above document the existing light theme; do not copy them into components or change global tokens for an isolated feature. Code theme tokens are independently owned by `student/editor-themes.ts`.

## Typography

Retain the existing system Chinese/Latin sans stack and monospace code stack. Body statements retain readable line height. No new fonts or packages.

## Layout

Keep controls compact, with wrapping header rows and min-width constraints. Long code scrolls inside its block. Theme controls sit above code and must not affect editor layout, stored drafts, requests, pricing, or assistance delivery.

## Elevation & Depth

Use existing surface/border/modal primitives; no new shadows or overlays for theme changes.

## Shapes

Reuse the existing half-rem base radius and component utility variants.

## Components

- `SolutionContent` is the shared ordinary/Paper 4/teacher-preview code-theme renderer. It receives a body only after existing authorization/delivery or teacher preview; it never fetches, purchases, or stores assistance bodies. Default GitHub Dark; all presets come from `editor-themes.ts`.
- Theme selection uses a visible label and native select. Platform-owned popup behavior is intentional, consistent with the established Paper 4 selector; preserve keyboard selection, focus outline, and localized accessible name.
- `LuqAssistance` owns quote/confirmation/unlock/delivery and existing retry/status rules. `Modal`, `Button`, `CodeBlock`, `MathContent`, and `useLocale` remain canonical owners for their respective behavior. Existing domain/security decisions live in `docs/luq-system.md` and D47–D50 of the design summary.
- A theme change is local presentation state: no network mutation, no new delivery, no balance change. Data/content publication remains independently authorized and audited.

- `CodeEditor` remains the shared textarea/highlight editor for ordinary problems and Paper 4. The optional Vim keymap is owned by `student/editor-vim.ts`, selected in the existing native key-binding control, and persisted by `useWorkspaceSettings`. Standard remains the default. Mode/search feedback belongs in the existing status row; no new toolbar or modal. Keyboard handling consumes Vim Escape without closing workspace panels; native Tab still moves focus outside insert mode. Only content changes notify draft owners.

## Do's and Don'ts

Editor follow-up: Escape in the focused code input enables Vim normal mode through the existing settings owner. Normal/visual modes use a full character block with the covered glyph repainted in the theme background color; the block uses `--code-foreground`. Insert mode uses a 3px vertical bar. Forced colors use CanvasText/Canvas. A non-collapsed native text range measures the current character, with one cell for tabs/empty lines; local coordinates account for CSS zoom. The decorative cursor stays clipped to the code viewport and hides on blur or activity read-only state. `FormatCodeIcon` owns the user-selected text-align-start paths for both answer workspaces, with currentColor and the existing toolbar size.

Use existing tokens and sibling controls, not a rebrand. Do not preload or persist locked translations/answers; do not expose reference programs, hidden tests or private notes via ordinary question payloads. Do not reset code or dirty state on theme changes. Scope verification to the touched workflows and record unrelated pre-existing audit findings separately.

### Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | SolutionContent native select and existing native form controls | editor-themes.ts, locale provider and this document | native platform popup | keyboard, light/dark presets, narrow layout |
| Date | Existing native datetime inputs | domain UTC/timezone rules and maintained task dialogs | native | no date changes in the Luq theme task |
