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

- **Template-driven, not hard-coded styling.** The doc is built by cloning a `🧩 Handover template` frame (found by name in the file, or on a page named `_Templates`). The template has named placeholder layers (for example `#title`, `#category`, `#purpose`, `#section/variants`, `#slot/variants-grid`). The code fills placeholders and generates content into `#slot/*` auto-layout frames. Designers restyle the template. Code doesn't change.
- If no template exists, offer a "Create starter template" action that builds a basic one. It uses local text styles and variables when they exist, and falls back to neutral defaults otherwise.
- Use auto layout everywhere, so sections grow with content.
- Mark each generated root frame with `setSharedPluginData("dds_compdoc", "generatedFor", componentId)`. Regenerating **replaces the existing frame in place** (same position and parent) and doesn't create duplicates.
- Generated frames are output. Tell the user in the UI that manual edits to a generated doc are lost on regenerate.
- Markdown → Figma text: map to `setRangeFontName` (bold/italic), `setRangeTextDecoration`, `setRangeListOptions` (lists), `setRangeHyperlink` (links), and text styles for H1 and code.
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
    template.ts         // find/clone template, fill placeholders
    markdown.ts         // md subset → styled Figma text
    sections/           // one file per auto section (variants, onDark, theme, anatomy, config, interactions)
  ui/                   // ui.html, ui.ts, components
```

## Working style

- Work in the phases I give you. Don't build ahead.
- At the end of each phase, list: what was built, what's stubbed, any API assumption you couldn't verify in the typings, and how I can test it manually in Figma.
- Prefer small, readable functions over clever abstractions. Designers on the team may read this code.
