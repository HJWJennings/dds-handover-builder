# Copilot instructions: DDS Compdoc plugin

> Save as `.github/copilot-instructions.md` in the plugin repo. Copilot reads it on every request, so every phase prompt (see `build-plan-prompts.md`) can stay short.

## What we're building

A Figma plugin for the DDS (Tesco's digital design system) team that:

1. Lists the components in the current file and shows which ones are documented.
2. Gives each component a documentation form. Answers are stored on the component.
3. Exports documentation as CSV and JSON.
4. **Generates a handover doc as native Figma frames on the canvas**, matching our existing handover doc layout. The generator builds the visual sections (variants, on-dark, theme, anatomy, configuration) automatically from the component itself.

UX reference: the Community plugin "Compdoc" (two-pane modal: searchable component tree on the left, form editor on the right, prev/next/skip/save footer, "Needs documentation" and "This page" filters, bulk-select checkboxes, Export menu).

## Tech constraints (non-negotiable)

- TypeScript, strict mode. Build with esbuild. Types come from `@figma/plugin-typings`. **Check API signatures against the typings; don't guess.** If an API is not in the typings, say so and stop.
- `manifest.json`: `"editorType": ["figma"]`, `"documentAccess": "dynamic-page"`, `"networkAccess": { "allowedDomains": ["none"] }`.
- Because of dynamic-page: use async APIs only (`figma.getNodeByIdAsync`, `figma.loadAllPagesAsync()`, `page.loadAsync()`, `instance.getMainComponentAsync()`). No sync `getNodeById`.
- UI is one HTML file with inlined JS/CSS (vanilla TS; no framework unless I approve one). `figma.showUI(__html__, { themeColors: true })`. Style with Figma's theme CSS variables so it works in light and dark mode.
- All main ↔ UI communication goes through typed messages. Keep a discriminated union in `src/messages.ts`.
- Load fonts with `figma.loadFontAsync` before any text write. Handle missing fonts gracefully and report them.
- Wrap `componentPropertyDefinitions` access in try/catch. It throws on component sets that have errors.
- No network calls. No telemetry.

## Data model

Store documentation in **`sharedPluginData`** on the `COMPONENT_SET` (or standalone `COMPONENT`):

- namespace: `dds_compdoc`
- key: `doc`
- value: JSON string

```ts
interface ComponentDoc {
  schemaVersion: 1;
  updatedAt: string;          // ISO
  updatedBy?: string;         // figma.currentUser?.name
  status: "draft" | "ready";  // "documented" = status ready AND required fields non-empty
  fields: {
    purpose: string;          // markdown, required
    whenToUse: string;        // markdown, required
    whenNotToUse: string;     // markdown, required
    responsive: string;       // markdown
    accessibility: string;    // markdown, required
    contentGuidance: string;  // markdown
    aiGuidance: string;       // markdown: instructions aimed at AI tools
    behaviourNotes: string;   // markdown: wrap, truncation, max length, keyboard, tab order
    storybookPath: string;    // e.g. "AI chat > Chat bubbles > User"
    storybookControls: string;// markdown
    links: { label: string; url: string }[]; // Storybook, Miro, zeroheight...
  };
  handover?: { frameId: string; generatedAt: string }; // last generated doc frame
}
```

**Optional "Sync to description" (per component, off by default):** writes a condensed `descriptionMarkdown` built from Purpose + When to use + AI guidance, so Dev Mode, Figma MCP and Make consumers can see it. sharedPluginData is the source of truth. The description is derived from it and never read back.

Rich text fields are stored as a **restricted markdown subset**: bold, italic, strikethrough, H1, bullet list, numbered list, link, inline code, code block. That's the same toolbar as Compdoc.

## Handover doc generation: principles

- Build each document directly in code with one `buildHandoverDoc(component, doc, ctx)` entry point. Do not create, clone, find, or version a persistent template. Existing `_Templates` pages/frames are user content and must remain untouched.
- Use auto layout everywhere, so sections grow with content. Put every layout measurement and type-scale value in `src/generate/layout.ts`.
- Mark each generated root frame with `setSharedPluginData("dds_compdoc", "generatedFor", componentId)`. Regenerating **replaces the existing frame in place** (same position and parent) and doesn't create duplicates.
- Generated frames are output. Tell the user in the UI that manual edits to a generated doc are lost on regenerate.
- Markdown → Figma text: reuse `parseMarkdown` from `src/shared/markdown.ts`; map to `setRangeFontName` (bold/italic), `setRangeTextDecoration`, `setRangeListOptions` (lists), and `setRangeHyperlink` (links).
- Show progress in the UI. Batch generation must yield (`await` between components) so Figma doesn't freeze. Support cancel.
- Wrap every generate in a single undo-able operation where possible. Never modify the source component.

## Code organisation

```
src/
  main.ts               // plugin entry, message router
  messages.ts           // typed message union
  scan/                 // component discovery, grouping, status
  store/                // sharedPluginData read/write, schema migrations
  export/               // csv.ts, json.ts
  generate/
    build.ts            // direct native frame construction and text-section filling
    layout.ts           // all widths, paddings, gaps, columns and type scale
    tokens.ts           // Web-only token selection, binding and fallback report
    fonts.ts            // font discovery, loading and fallback report
    markdown.ts         // restricted markdown → styled Figma text
  ui/                   // ui.html, ui.ts, components
```

## Working style

- Work in the phases I give you. Don't build ahead.
- At the end of each phase, list: what was built, what's stubbed, any API assumption you couldn't verify in the typings, and how I can test it manually in Figma.
- Prefer small, readable functions over clever abstractions. Designers on the team may read this code.

## DDS file findings (from inspector, Sept 2026)

- Theming is done with variable modes, not variants. Collections: `Web` and `Web brand 2026`, both with modes Tesco, Tesco dark mode, F&F, F&F dark mode, Lo-Fi.
- On-dark section: wrap instances in a frame and setExplicitVariableModeForCollection to "Tesco dark mode" on BOTH collections.
- Optional brand section: same approach with "F&F".
- DDS vs EDS comparison is a separate library (DDS Enterprise Domain Library). Not auto-generated; leave it as a manual section.
- Components don't use TEXT properties (DDS convention). Show text content via the layer's existing characters and don't try to set text properties.
- BOOLEAN property names carry ID suffixes (e.g. "Headline#75:0"). Strip "#…" for display, keep the full name for setProperties.
- No prototype reactions currently. The interactions section is hidden unless reactions exist.

## Handover doc design

- Generated handover documents are native Figma frames, 1600px wide, with a 1520px inner content width and 40px horizontal page padding. Use vertical auto layout with no gap between sections; header band vertical padding is 80px with 8px internal gaps, and sections use 40px padding with 24px gaps.
- Build from code for every generation; do not depend on named placeholders or stored template frames. Keep `buildHandoverDoc(component, doc, ctx)` as the generator entry point.
- Section order: Header band; At a glance; Visual reference; Key changes; When to use; When NOT to use; Storybook hierarchy; Responsive; Variants; Smaller theme; Design tokens; Configuration and behaviour; Structure breakdown; Interactive flows, animation and transitions; Content guidance; Accessibility; AI guidance; Footer band. `SECTION_NUMBERS` defaults to false.
- Empty sections use the muted text `Not documented yet.`; Key changes uses `None recorded.`. Keep `EMPTY_SECTIONS` configurable as `placeholder` or `hide`, default `placeholder`. Phase 4 slots use a dashed outline and muted `Auto-generated in Phase 5` or `Auto-generated in Phase 6` text.
- Slots remain native dashed-outline frames named `#slot/<name>` for Phases 5-6. Place on-dark and theme slots after Variants; DDS vs EDS is a manual placeholder in Smaller theme.
- Bind only to variables in the collection named `Web`. Use exact role candidates first; only use value matching when no confirmed candidate name exists. Bind an exact-name variable even when its value differs from the expected sRGB hex, and report both the resolved and expected values. Report every fallback, ambiguous match, mismatch and `NOT FOUND in Web`; never silently select among multiple matches. Do not bind to similarly named brand/native/global collections.
- Expected sRGB blue values: `bandFill` and `heading` use `#00539F`; dark navy uses `#002343`. Do not use screenshot-sampled Display P3 values.
- Preferred font family is exactly `TESCO Modern`, falling back to `Inter`; choose regular and bold styles by exact case-insensitive style name. Use `Italic`, then `Regular Italic`, only if available. Inline and block code prefer `Roboto Mono`, falling back to the body font. Load every font with `figma.loadFontAsync` before writing text and report chosen styles/fallbacks.
- Keep all layout and type-scale constants in `src/generate/layout.ts`. The current placeholder scale is category 16/24; title 56/68 bold; summary 20/28; H2 32/44 bold; H3 24/32; body 20/28; caption 16/24.
- Generation does not switch the user's page. Offer a `Show doc` action in the result modal to navigate to the output frame on `Handover docs`.