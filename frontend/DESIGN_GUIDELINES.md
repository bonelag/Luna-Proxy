# Xiaomi MiMo — Luna Proxy UI Design Guidelines

Context and goals
- Intent: Create implementation-ready, token-driven UI guidance for Luna Proxy (part of Proxy-Luna UI). The guidance must support consistent, accessible, and fast delivery of a lightweight management UI for model proxying.
- Audience: developers and designers building the Luna Proxy admin UI for local management and testing.

Design tokens and foundations
- Font stack: `font.family.primary` must be `PTSerif-Regular` with fallback `Georgia, Times New Roman, serif`.
- Base typography: `font.size.base` must be `28px`, `font.weight.base` must be `600`, `font.lineHeight.base` must be `36.4px`.
- Typography scale must include: xs=14px, sm=16px, md=18px, lg=20px, xl=24px, 2xl=28px, 3xl=64px, 4xl=96px.
- Colors (semantic tokens):
  - `color.surface.base` must represent the primary surface (used for brand blocks) and is mapped to `--color-surface-base`.
  - `color.text.secondary` must be used for secondary text.
  - `color.text.tertiary` must be used for body text.
  - `color.text.inverse` must be used for prominent text on light surfaces.
  - `color.surface.muted` must be used as the app canvas background.
  - `color.border.default` and `color.border.muted` must be used for separators and subtle borders.
- Spacing scale: space.1=6px, space.2=8px, space.3=12px, space.4=16px, space.5=24px.
- Motion: motion.duration.instant=200ms, motion.duration.fast=400ms.

Component-level rules

Global rules (applies to every component)
- Every interactive element must define states for default, hover, focus-visible, active, disabled, loading, and error.
- All components must use semantic tokens (no raw hex literals in component code).
- Components must expose a keyboard focus-visible style that is always visible and meets contrast requirements.

Layout (app shell)
- Anatomy: sidebar, topbar, content area.
- Sidebar must collapse responsively to a horizontal strip on narrow viewports.
- Sidebar links must be keyboard navigable using `Tab` and `Enter`/`Space` to activate.

Nav item (sidebar link)
- Anatomy: icon (optional) + label.
- Variants: default, compact (icon-only), active.
- States: default, hover (background: surface.muted), focus-visible (outline: 3px solid color.text.inverse), active (background: border.muted), disabled (50% opacity, no pointer events).
- Keyboard: `Enter` or `Space` must activate. Arrow keys should move focus if the nav is in a toolbar role.

Card
- Anatomy: title, body, metadata.
- Variants: info, warning, error.
- States: default (elevated), hover (border darkens), focus-visible (outline), disabled.
- Responsive: cards wrap into a single column under 800px.

Form controls (inputs, selects, buttons)
- Inputs must have a visible label. Labels must not be ambiguous.
- Inputs must have placeholder text only as assistance; label must remain visible.
- Buttons must provide `aria-pressed` for toggle states when applicable.
- Buttons must have a minimum touch target of 44x44 px.

Table / Logs
- Rows must support keyboard focus; row actions must be reachable via keyboard.
- Long text cells must truncate with an ellipsis and provide a tooltip or details panel for full content.

Interactions and behaviors
- Keyboard: All interactive components must be operable using keyboard alone (Tab, Shift+Tab, Enter, Space, Arrow keys where applicable).
- Pointer: Hover states should provide subtle affordances; clicking must be committal.
- Touch: All interactive targets must be at least 44x44px on touch devices.

Accessibility requirements and testable acceptance criteria
- Target: WCAG 2.2 AA. All rules below must be testable:
  1. Focus indicators: every interactive element must show a focus-visible style when focused via keyboard. Test: Tab through the UI; each element must show a visible ring (pass/fail).
  2. Contrast: body text must be minimum 4.5:1 against its background, large text 3:1. Test: Use a contrast tool against `color.text.tertiary` on `color.surface.muted` (pass/fail).
  3. Keyboard operability: all functions must be reachable and operable via keyboard. Test: Complete a basic task (add provider) using keyboard only (pass/fail).
  4. Semantic landmarks: must use `role=navigation`, `main`, `header`, and headings in order. Test: Run an automated accessibility scan for missing landmarks (pass/fail).
  5. Form labels: every input must have an associated label. Test: Inspect the DOM for inputs without labels (pass/fail).

Content and tone standards with examples
- Tone must be concise, confident, and implementation-focused.
- UI copy must be explicit; avoid ambiguous labels like "Process" — use "Start Proxy" or "Stop Proxy".
- Examples:
  - Good: "Add Provider" — clear CTA.
  - Bad: "Go" — ambiguous.

Anti-patterns and prohibited implementations
- Do not use low-contrast text (must not). If contrast cannot reach required ratios, do not use the color.
- Do not hide focus indicators behind custom visuals (must not).
- Do not introduce one-off spacing exceptions (must not); use spacing tokens.

Edge-case handling and migration notes
- Empty states: Every list or table must provide an empty-state message and an action when appropriate (must).
- Long content: Must support truncation with access to full content (details panel or tooltip).
- Migration: When updating tokens, teams should prefer updating the token mapping centrally; components should consume tokens instead of hardcoded values (should).

QA checklist
- All interactive elements show focus-visible outlines (manual keyboard test).
- Contrast checks pass for body and heading text (contrast tool).
- Forms are fully operable with keyboard (add provider test).
- Empty states are present for lists and logs (visual inspection).
- No raw color literals in component code (code scan).

Component Rule Expectations (summary)
- Keyboard: must support Tab/Shift+Tab, Enter/Space activation, Arrow navigation where applicable.
- Pointer: hover and active states must be provided and consistent.
- Touch: interactive elements must have 44x44px minimum targets.
- Spacing & typography: must use spacing and font tokens only.

Extraction diagnostics
- Audience and product surface inference confidence: LOW. Confirm product audience and primary use-cases before finalizing voice/content tokens.
