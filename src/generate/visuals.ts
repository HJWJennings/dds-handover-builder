import type { ComponentDoc } from '../store/types';
import type { DocumentableNode } from '../store/docStatus';
import { getComponentPropertyDefinitions } from '../inspect';
import { THEME_MODES, themeDarkModeName, WEB_COLLECTION_NAME } from './config';
import { planGrid, type GridPlan } from './plan';
import {
  CONTENT_WIDTH,
  GRID_COLUMN_GAP,
  GRID_ROW_GAP,
  MAX_DOC_INSTANCES,
  SECTION_GAP,
  setSizing,
  setSizingLogger,
} from './layout';
import { appendStyledText } from './markdown';
import type { GenerationFonts } from './fonts';
import { makeSolidPaint, type HandoverTokenSet } from './tokens';

export interface SectionStatus {
  name: string;
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  stack?: string;
  durationMs: number;
}

export interface Phase5VisualReport {
  instanceCount: number;
  gridCount: number;
  warnings: string[];
  sections: SectionStatus[];
  log: string[];
  themeChecks: string[];
  variantsPlaced: number;
  variantsTotal: number;
  variantsOther: number;
  onDarkInfo: string;
  onDarkBackings: FrameNode[];
}

interface VisualContext {
  fonts: GenerationFonts;
  tokens: HandoverTokenSet;
}

type PropertyDef = {
  propertyName: string;
  type: string | null;
  defaultValue: unknown;
  variantOptions: string[];
};

const CELL_PAD = 32;
const BODY_PAD = 24;
const ROW_GAP = 24;
const GROUP_GAP = 24;
const BACKING_RADIUS = 8;
const ROW_LABEL_COL_WIDTH = 160;
const UNDERLINE_HEIGHT = 2;
const MIN_COLUMN_WIDTH = 96;
const POSITION_TOLERANCE = 4;
const HEADER_ROW_PAD = 8;
const GRID_TO_HEADER_GAP = 8;
const LOG_CAP = 500;

/** Stage wrapper for the grid builder: logs start/ok/failed with timing, rethrows with the stage name. */
const gridStep = <T>(name: string, log: string[], fn: () => T): T => {
  genLog(log, 'log', `[gen] grid step start ${name}`);
  const start = Date.now();
  try {
    const result = fn();
    genLog(log, 'log', `[gen] grid step ok ${name} ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    genLog(log, 'error', `[gen] grid step failed ${name}`, error instanceof Error ? error.stack : String(error));
    throw new Error(`grid step '${name}' failed: ${message}`);
  }
};

const stripHash = (name: string) => name.replace(/#.*$/, '');
const ON_DARK_PATTERN = /(on[ _-]?dark|inverse)/i;
const STATE_PATTERN = /^(state|status|interaction|focus(ed)?|hover)$/i;
const ON_VALUE_PATTERN = /^(yes|true|on|dark|inverse)$/i;
const SYNTHETIC_ON_DARK = 'On dark';

/** Built-in log: console output plus an in-memory copy sent to the UI with the result. */
const genLog = (lines: string[], level: 'log' | 'warn' | 'error', ...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
  lines.push(line);
  if (lines.length > LOG_CAP) lines.shift();
  if (level === 'warn') console.warn(...args);
  else if (level === 'error') console.error(...args);
  else console.log(...args);
};

/** Muted, always-readable note line. Works in any parent, auto layout or not. */
const addNote = (
  parent: FrameNode,
  text: string,
  ctx: VisualContext,
): TextNode => {
  let target = parent;
  if (parent.layoutMode === 'NONE') {
    const wrapper = vFrame(`${parent.name}/note-wrapper`);
    parent.appendChild(wrapper);
    wrapper.x = 0;
    wrapper.y = 0;
    target = wrapper;
  }
  const note = appendStyledText(target, text, 'caption', ctx.fonts, ctx.tokens, { name: 'Note', resizeMode: 'HEIGHT' });
  const token = ctx.tokens.roles.textBody;
  note.fills = [makeSolidPaint(token.value, token.variable)];
  setSizing(note, 'FILL');
  note.textAutoResize = 'HEIGHT';
  return note;
};

/** Runs one section builder, times it, and turns throws into failed statuses with a visible note. */
const runSectionAsync = async (
  name: string,
  build: () => Promise<string | undefined> | string | undefined,
  container: FrameNode | null,
  ctx: VisualContext,
  log: string[],
): Promise<SectionStatus> => {
  const start = Date.now();
  try {
    const reason = await build();
    return { name, status: reason ? 'skipped' : 'ok', reason, durationMs: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? message : String(error);
    genLog(log, 'error', '[gen] section failed', name, stack);
    if (container) addNote(container, `Couldn't build this section: ${message}`, ctx);
    return { name, status: 'failed', reason: message, stack, durationMs: Date.now() - start };
  }
};

// ---------- Frame helpers ----------

const vFrame = (name: string): FrameNode => {
  const frame = figma.createFrame();
  frame.name = name;
  frame.fills = [];
  frame.clipsContent = false;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.primaryAxisAlignItems = 'MIN';
  frame.counterAxisAlignItems = 'MIN';
  return frame;
};

const wrapFrame = (name: string): FrameNode => {
  const frame = figma.createFrame();
  frame.name = name;
  frame.fills = [];
  frame.clipsContent = false;
  frame.layoutMode = 'HORIZONTAL';
  frame.layoutWrap = 'WRAP';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.primaryAxisAlignItems = 'MIN';
  frame.counterAxisAlignItems = 'MIN';
  frame.itemSpacing = GRID_COLUMN_GAP;
  frame.counterAxisSpacing = GRID_COLUMN_GAP;
  return frame;
};

const addText = (
  parent: FrameNode,
  value: string,
  role: 'body' | 'caption' | 'h3',
  ctx: VisualContext,
  options: { color?: 'textBody' | 'textOnDark' | 'textPrimary'; bold?: boolean; muted?: boolean } = {},
): TextNode => {
  const text = appendStyledText(parent, value, role, ctx.fonts, ctx.tokens, {
    name: value.slice(0, 48) || 'Text',
    resizeMode: 'HEIGHT',
  });
  text.textAlignHorizontal = 'LEFT';
  if (options.color) {
    const token = ctx.tokens.roles[options.color];
    text.fills = [makeSolidPaint(token.value, token.variable)];
  }
  if (options.bold) text.fontName = ctx.fonts.bold;
  if (options.muted) text.opacity = 0.55;
  return text;
};

const GENERATED_NS = 'dds_compdoc';

/** Removes exactly the captured placeholder node. Called only after a builder reports ok. */
const removePlaceholder = (root: FrameNode, key: string) => {
  const slot = root.findAll((node) => node.type === 'FRAME' && node.name === `#slot/${key}`)[0];
  if (!slot || slot.type !== 'FRAME') return;
  const placeholderId = slot.getSharedPluginData(GENERATED_NS, `placeholder:${key}`);
  const placeholder = slot.children.find((child) => child.id === placeholderId);
  if (placeholder && !placeholder.removed) placeholder.remove();
  slot.setSharedPluginData(GENERATED_NS, `placeholder:${key}`, '');
};

/** Restyles a slot for filled content; removes nothing. The placeholder goes only on success. */
const prepareSlot = (root: FrameNode, key: string): FrameNode | null => {
  const slot = root.findAll((node) => node.type === 'FRAME' && node.name === `#slot/${key}`)[0];
  if (!slot || slot.type !== 'FRAME') return null;
  slot.strokes = [];
  slot.dashPattern = [];
  slot.clipsContent = false;
  slot.paddingTop = 0;
  slot.paddingRight = 0;
  slot.paddingBottom = 0;
  slot.paddingLeft = 0;
  slot.layoutMode = 'VERTICAL';
  slot.primaryAxisSizingMode = 'AUTO';
  slot.counterAxisSizingMode = 'FIXED';
  slot.primaryAxisAlignItems = 'MIN';
  slot.counterAxisAlignItems = 'MIN';
  slot.itemSpacing = SECTION_GAP;
  return slot;
};

const removeSlot = (root: FrameNode, key: string) => {
  const slot = root.findAll((node) => node.type === 'FRAME' && node.name === `#slot/${key}`)[0];
  if (slot) slot.remove();
};

/** Phase 6 slots keep their dashed placeholder look; nothing is removed here. */
const clearSlot = (root: FrameNode, key: string): FrameNode | null => {
  const slot = root.findAll((node) => node.type === 'FRAME' && node.name === `#slot/${key}`)[0];
  if (!slot || slot.type !== 'FRAME') return null;
  slot.layoutMode = 'VERTICAL';
  slot.itemSpacing = SECTION_GAP;
  return slot;
};

const getBaseComponent = (component: DocumentableNode): ComponentNode | null => {
  if (component.type === 'COMPONENT') return component;
  if (component.type === 'COMPONENT_SET') return component.defaultVariant ?? component.children[0] ?? null;
  return null;
};

const propertyDefs = (component: DocumentableNode): PropertyDef[] =>
  getComponentPropertyDefinitions(component).map((definition) => ({
    propertyName: definition.propertyName,
    type: definition.type,
    defaultValue: definition.defaultValue,
    variantOptions: definition.variantOptions.map(String),
  }));

const variantValue = (variant: ComponentNode, propertyName: string): string => {
  const raw = variant.variantProperties?.[propertyName];
  return typeof raw === 'string' ? raw : '';
};

const instantiate = (
  parent: FrameNode,
  variant: ComponentNode,
  booleans: Array<[string, boolean]>,
  report: Phase5VisualReport,
  maxWidth?: number,
): InstanceNode | null => {
  if (report.instanceCount >= MAX_DOC_INSTANCES) {
    report.warnings.push(`Handover instance limit (${MAX_DOC_INSTANCES}) reached; ${variant.name} omitted.`);
    return null;
  }
  try {
    const instance = variant.createInstance();
    parent.appendChild(instance);
    for (const [rawName, value] of booleans) {
      try {
        instance.setProperties({ [rawName]: value });
      } catch (error) {
        report.warnings.push(`Could not set Boolean property ${stripHash(rawName)} on ${variant.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const expectedWidth = maxWidth !== undefined && variant.width > maxWidth ? maxWidth : variant.width;
    const expectedHeight = maxWidth !== undefined && variant.width > maxWidth ? variant.height * (maxWidth / variant.width) : variant.height;
    setSizing(instance, 'FIXED', 'FIXED');
    instance.resize(Math.max(1, expectedWidth), Math.max(1, expectedHeight));
    if (Math.abs(instance.width - expectedWidth) > 1 || Math.abs(instance.height - expectedHeight) > 1) {
      report.warnings.push(`Instance of ${variant.name} resized to ${Math.round(instance.width)}×${Math.round(instance.height)}; expected ${Math.round(expectedWidth)}×${Math.round(expectedHeight)}.`);
    }
    if (instance.parent !== parent || instance.width <= 0 || instance.height <= 0) {
      genLog(report.log, 'warn', '[gen] instance problem', variant.name);
      report.warnings.push(`Instance of ${variant.name} failed the size/parent check.`);
      instance.remove();
      return null;
    }
    report.instanceCount += 1;
    return instance;
  } catch (error) {
    report.warnings.push(`Could not create an instance of ${variant.name}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

const getWebCollections = async (report: Phase5VisualReport): Promise<VariableCollection[]> => {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    return collections.filter((collection) => collection.name === 'Web' || collection.name === 'Web brand 2026');
  } catch (error) {
    report.warnings.push(`Could not read variable collections: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
};

const setMode = (node: FrameNode, collection: VariableCollection, modeName: string, report: Phase5VisualReport): boolean => {
  const mode = collection.modes.find((entry) => entry.name === modeName);
  if (!mode) return false;
  try {
    node.setExplicitVariableModeForCollection(collection, mode.modeId);
    return true;
  } catch (error) {
    report.warnings.push(`Could not set ${collection.name} mode "${modeName}": ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

const modeNamesOf = (node: FrameNode, collections: VariableCollection[]): string[] => {
  const modes = node.resolvedVariableModes;
  return collections.map((collection) => {
    const modeId = modes[collection.id];
    return `${collection.name}: ${collection.modes.find((mode) => mode.modeId === modeId)?.name ?? 'default'}`;
  });
};

const labelFor = (doc: ComponentDoc | null, property: string, value: string): string =>
  doc?.handoverConfig?.labels?.[`${property}=${value}`] ?? `${stripHash(property)} (${value})`;

// ---------- Design order ----------

const designOrder = (
  variants: ComponentNode[],
  axis: string,
  defs: PropertyDef[],
  direction: 'columns' | 'rows',
  doc: ComponentDoc | null,
): string[] => {
  const present = [...new Set(variants.map((variant) => variantValue(variant, axis)))];
  const sorted = [...variants].sort((a, b) => {
    const primaryA = direction === 'columns' ? a.x : a.y;
    const primaryB = direction === 'columns' ? b.x : b.y;
    const secondaryA = direction === 'columns' ? a.y : a.x;
    const secondaryB = direction === 'columns' ? b.y : b.x;
    if (Math.abs(primaryA - primaryB) > POSITION_TOLERANCE) return primaryA - primaryB;
    return secondaryA - secondaryB;
  });
  const byPosition: string[] = [];
  for (const variant of sorted) {
    const value = variantValue(variant, axis);
    if (!byPosition.includes(value)) byPosition.push(value);
  }
  const separates = present.every((value) => {
    const positions = variants
      .filter((variant) => variantValue(variant, axis) === value)
      .map((variant) => (direction === 'columns' ? variant.x : variant.y));
    const min = Math.min(...positions);
    const max = Math.max(...positions);
    return present.every((other) => {
      if (other === value) return true;
      const otherPositions = variants
        .filter((variant) => variantValue(variant, axis) === other)
        .map((variant) => (direction === 'columns' ? variant.x : variant.y));
      return Math.max(...otherPositions) + POSITION_TOLERANCE <= min || max + POSITION_TOLERANCE <= Math.min(...otherPositions);
    });
  });
  let ordered: string[];
  if (separates && byPosition.length === present.length) {
    ordered = byPosition;
  } else {
    const def = defs.find((entry) => entry.propertyName === axis);
    const defaultValue = String(def?.defaultValue ?? '');
    ordered = [
      ...(defaultValue && present.includes(defaultValue) ? [defaultValue] : []),
      ...(def ? def.variantOptions.filter((option) => present.includes(option) && option !== defaultValue) : present.filter((value) => value !== defaultValue)),
    ];
  }
  return doc?.handoverConfig?.reverse?.[axis] ? [...ordered].reverse() : ordered;
};

const variantsByPosition = (variants: ComponentNode[]): ComponentNode[] =>
  [...variants].sort((a, b) => (Math.abs(a.x - b.x) > POSITION_TOLERANCE ? a.x - b.x : a.y - b.y));

// ---------- Grid builder ----------

const rowKeyOf = (combo: Record<string, string>, rowAxes: string[]): string =>
  rowAxes.map((axis) => combo[axis]).join('‖');

/** Throws a named error when a helper is about to write to a removed node. */
const assertAlive = (node: BaseNode, label: string) => {
  if (node.removed) throw new Error(`stale node: ${label}`);
  // Force a read; a node that can't be read is stale even if .removed is stale itself.
  void node.id;
};

/**
 * naturalText(parent, characters, style): creates the text node in its real parent, sets the
 * font (pre-loaded) and characters, measures natural size, returns { node, width, height }.
 * The node is never removed — callers use it as the visible label.
 */
const naturalText = (
  parent: FrameNode,
  value: string,
  role: 'body' | 'caption',
  ctx: VisualContext,
  bold: boolean,
): { node: TextNode; width: number; height: number } => {
  assertAlive(parent, 'naturalText parent');
  const text = appendStyledText(parent, value, role, ctx.fonts, ctx.tokens, { resizeMode: 'WIDTH_AND_HEIGHT' });
  if (bold) text.fontName = ctx.fonts.bold;
  text.textAlignHorizontal = 'LEFT';
  return { node: text, width: text.width, height: text.height };
};

/** Absolute-coordinate grid: one FIXED frame, layoutMode NONE, children placed by derived x/y. */
const renderGrid = (
  parent: FrameNode,
  variants: ComponentNode[],
  plan: GridPlan,
  params: {
    width: number;
    doc: ComponentDoc | null;
    booleans: Array<[string, boolean]>;
    onDarkBackings: FrameNode[];
    /** Synthetic On dark axis — only ever enabled when the component's onDarkSource is "mode". */
    syntheticDark?: { enabled: boolean; darkCollections: VariableCollection[]; darkModeName: string };
  },
  ctx: VisualContext,
  report: Phase5VisualReport,
): { node: FrameNode; placed: number; unplaced: ComponentNode[] } => {
  const doc = params.doc;
  const softAssert = (condition: boolean, message: string) => {
    if (!condition) {
      genLog(report.log, 'warn', '[gen] assert', message);
      report.warnings.push(message);
    }
  };

  const effectiveColumnAxes = plan.columnAxes.map((axis) => axis.name);
  const effectiveRowAxes = plan.rowAxes.map((axis) => axis.name);
  const columnCombos = plan.leaves.map((leaf) => leaf.values);
  const effectiveRowCombos = plan.rows.map((row) => row.values);
  const leafCombos = columnCombos.length > 0
    ? columnCombos.flatMap((column) => effectiveRowCombos.map((row) => ({ ...column, ...row })))
    : effectiveRowCombos;

  // Soft asserts from the plan plus a placement sanity check.
  plan.warnings.forEach((message) => softAssert(false, message));
  if (columnCombos.length === 0) throw new Error('zero columns: plan produced no leaves');
  if (effectiveRowCombos.length === 0) throw new Error('zero rows: plan produced no rows');

  // Placement comes from the plan; variants resolve by name.
  const byName = new Map(variants.map((variant) => [variant.name, variant]));
  const match = (combo: Record<string, string>) => {
    const placement = plan.placements.find((entry) => {
      const leaf = plan.leaves[entry.leafIndex];
      const row = plan.rows[entry.rowIndex];
      return leaf && row
        && effectiveColumnAxes.every((axis) => leaf.values[axis] === combo[axis])
        && effectiveRowAxes.every((axis) => row.values[axis] === combo[axis]);
    });
    return placement ? byName.get(placement.variantName) ?? null : null;
  };
  const placedIds = new Set(leafCombos.map((combo) => match(combo)?.id).filter((id): id is string => Boolean(id)));
  const unplaced = variants.filter((variant) => !placedIds.has(variant.id));
  const labelText = (axis: string, value: string) => labelFor(doc, axis, value);

  genLog(report.log, 'log', '[gen] plan', JSON.stringify({
    columns: plan.columnAxes.map((axis) => `${axis.name}${axis.synthetic ? ' (synthetic)' : ''}: ${axis.values.join('/')}`),
    rows: plan.rowAxes.map((axis) => `${axis.name}: ${axis.values.join('/')}`),
    leaves: plan.leaves.length,
    placements: plan.placements.length,
  }));

  // Shared measurements. The grid frame is created first so texts are made in their real parent.
  //   The grid is layoutMode NONE: it is sized only with resize() from the computed numbers.
  const grid = figma.createFrame();
  grid.name = '#variants/grid';
  grid.layoutMode = 'NONE';
  grid.fills = [];
  grid.clipsContent = false;
  grid.resize(1, 1);
  parent.appendChild(grid);
  report.gridCount += 1;

  const headerTexts: Array<{ level: number; value: string; node: TextNode; width: number; height: number }> = [];
  const labelTexts: Array<{ axis: string; value: string; node: TextNode; width: number; height: number }> = [];
  let headerRowHeights: number[] = [];
  let labelColWidths: number[] = [];
  let columnWidths: number[] = [];
  let rowHeights: number[] = [];

  gridStep('measure', report.log, () => {
    for (let level = 0; level < effectiveColumnAxes.length; level += 1) {
      const values = [...new Set(columnCombos.map((combo) => combo[effectiveColumnAxes[level]]))];
      for (const value of values) {
        headerTexts.push({ level, value, ...naturalText(grid, labelText(effectiveColumnAxes[level], value), level === 0 ? 'body' : 'caption', ctx, true) });
      }
    }
    headerRowHeights = Array.from({ length: effectiveColumnAxes.length }, (_, level) =>
      Math.max(1, ...headerTexts.filter((entry) => entry.level === level).map((entry) => entry.height)) + HEADER_ROW_PAD);

    for (const axis of plan.rowAxes) {
      const values = [...new Set(effectiveRowCombos.map((combo) => combo[axis.name]))];
      for (const value of values) {
        labelTexts.push({ axis: axis.name, value, ...naturalText(grid, labelText(axis.name, value), 'caption', ctx, false) });
      }
    }
    labelColWidths = plan.rowAxes.map((axis) =>
      Math.max(ROW_LABEL_COL_WIDTH, ...labelTexts.filter((entry) => entry.axis === axis.name).map((entry) => entry.width)) + BODY_PAD);

    const sizeOf = (combo: Record<string, string>) => {
      const variant = match(combo);
      return variant ? { width: variant.width, height: variant.height } : { width: 1, height: 1 };
    };
    const innerLevel = effectiveColumnAxes.length - 1;
    columnWidths = columnCombos.map((column) => {
      const headerWidth = headerTexts.find((entry) => entry.level === innerLevel && entry.value === column[effectiveColumnAxes[innerLevel]])?.width ?? 1;
      return Math.max(MIN_COLUMN_WIDTH, ...effectiveRowCombos.map((row) => sizeOf({ ...column, ...row }).width + CELL_PAD), headerWidth + CELL_PAD);
    });
    rowHeights = effectiveRowCombos.map((row) =>
      Math.max(1, ...columnCombos.map((column) => sizeOf({ ...column, ...row }).height + CELL_PAD)));

    genLog(report.log, 'log', '[gen] col widths', columnCombos.map((column, index) => ({
      column: effectiveColumnAxes.map((axis) => column[axis]).join('/'),
      final: Math.round(columnWidths[index]),
    })));
  });

  // Coordinates.
  const labelColumnsTotalWidth = labelColWidths.reduce((total, width) => total + width, 0) + GRID_COLUMN_GAP * Math.max(0, labelColWidths.length - 1);
  const outerValues = [...new Set(columnCombos.map((combo) => combo[effectiveColumnAxes[0]]))];
  const groupsX: number[] = [];
  const groupLeaves: number[][] = [];
  let cursor = labelColumnsTotalWidth + (labelColumnsTotalWidth > 0 ? GROUP_GAP : 0);
  for (const outerValue of outerValues) {
    const leafIndexes = columnCombos.map((_, index) => index).filter((index) => columnCombos[index][effectiveColumnAxes[0]] === outerValue);
    groupLeaves.push(leafIndexes);
    groupsX.push(cursor);
    cursor += leafIndexes.reduce((total, index) => total + columnWidths[index], 0) + GRID_COLUMN_GAP * Math.max(0, leafIndexes.length - 1) + GROUP_GAP;
  }
  const totalWidth = Math.max(1, cursor - GROUP_GAP);
  // Fit belongs to the planner; the grid must still never exceed the content width.
  if (totalWidth > params.width) {
    genLog(report.log, 'warn', '[gen] grid too wide', Math.round(totalWidth), 'exceeds', params.width);
    report.warnings.push(`grid too wide: ${Math.round(totalWidth)}px exceeds ${params.width}px content width`);
  }
  const headerBlockHeight = headerRowHeights.reduce((total, height) => total + height, 0) + GRID_ROW_GAP * Math.max(0, headerRowHeights.length - 1);
  const bodyTop = headerBlockHeight + GRID_TO_HEADER_GAP;
  const bodyHeight = rowHeights.reduce((total, height) => total + height, 0) + ROW_GAP * Math.max(0, rowHeights.length - 1) + 2 * BODY_PAD;
  const totalHeight = Math.max(1, bodyTop + bodyHeight);
  grid.resize(totalWidth, totalHeight);

  gridStep('headers', report.log, () => {
    let headerY = 0;
    for (let level = 0; level < effectiveColumnAxes.length; level += 1) {
      const rowHeight = headerRowHeights[level];
      const values = [...new Set(columnCombos.map((combo) => combo[effectiveColumnAxes[level]]))];
      for (const value of values) {
        const leafIndexes = columnCombos.map((_, index) => index).filter((index) => columnCombos[index][effectiveColumnAxes[level]] === value);
        const firstLeaf = leafIndexes[0];
        const groupIndex = outerValues.indexOf(columnCombos[firstLeaf][effectiveColumnAxes[0]]);
        const leafX = groupsX[groupIndex]
          + groupLeaves[groupIndex].slice(0, groupLeaves[groupIndex].indexOf(firstLeaf)).reduce((total, index) => total + columnWidths[index] + GRID_COLUMN_GAP, 0);
        const text = headerTexts.find((entry) => entry.level === level && entry.value === value)?.node;
        if (!text) continue;
        const token = level === 0 ? ctx.tokens.roles.textPrimary : ctx.tokens.roles.textBody;
        text.fills = [makeSolidPaint(token.value, token.variable)];
        text.x = leafX;
        text.y = headerY + (rowHeight - text.height) / 2;
        if (level === 0) {
          const underline = figma.createFrame();
          underline.name = '#variants/grid/header-underline';
          underline.fills = [makeSolidPaint(ctx.tokens.roles.heading.value, ctx.tokens.roles.heading.variable)];
          underline.clipsContent = false;
          const spanWidth = leafIndexes.reduce((total, index) => total + columnWidths[index], 0) + GRID_COLUMN_GAP * Math.max(0, leafIndexes.length - 1);
          underline.resize(Math.max(1, spanWidth), UNDERLINE_HEIGHT);
          grid.appendChild(underline);
          underline.x = leafX;
          underline.y = headerY + rowHeight - UNDERLINE_HEIGHT - 2;
        }
      }
      headerY += rowHeight + GRID_ROW_GAP;
    }
  });

  gridStep('row labels', report.log, () => {
    let labelX = 0;
    for (let axisIndex = 0; axisIndex < plan.rowAxes.length; axisIndex += 1) {
      const axis = plan.rowAxes[axisIndex];
      let rowY = bodyTop + BODY_PAD;
      let rowIndex = 0;
      while (rowIndex < effectiveRowCombos.length) {
        const combo = effectiveRowCombos[rowIndex];
        const text = labelTexts.find((entry) => entry.axis === axis.name && entry.value === combo[axis.name])?.node;
        if (axisIndex === 0) {
          const spanCount = effectiveRowCombos.filter((entry) => entry[axis.name] === combo[axis.name]).length;
          const spanHeight = rowHeights.slice(rowIndex, rowIndex + spanCount).reduce((total, height) => total + height, 0) + ROW_GAP * Math.max(0, spanCount - 1);
          if (text) {
            const token = ctx.tokens.roles.textBody;
            text.fills = [makeSolidPaint(token.value, token.variable)];
            text.fontName = ctx.fonts.bold;
            text.x = labelX;
            text.y = rowY;
          }
          rowY += spanHeight + ROW_GAP;
          rowIndex += spanCount;
        } else {
          if (text) {
            const token = ctx.tokens.roles.textBody;
            text.fills = [makeSolidPaint(token.value, token.variable)];
            text.x = labelX;
            text.y = rowY + (rowHeights[rowIndex] - text.height) / 2;
          }
          rowY += rowHeights[rowIndex] + ROW_GAP;
          rowIndex += 1;
        }
      }
      labelX += labelColWidths[axisIndex] + GRID_COLUMN_GAP;
    }
  });

  // Groups, backing and instances.
  const outerAxisIsOnDark = ON_DARK_PATTERN.test(stripHash(effectiveColumnAxes[0] ?? '')) || effectiveColumnAxes[0] === SYNTHETIC_ON_DARK;
  gridStep('backing', report.log, () => {
    for (let groupIndex = 0; groupIndex < outerValues.length; groupIndex += 1) {
      const outerValue = outerValues[groupIndex];
      const isOnGroup = outerAxisIsOnDark && ON_VALUE_PATTERN.test(outerValue);
      const groupWidth = groupLeaves[groupIndex].reduce((total, index) => total + columnWidths[index], 0) + GRID_COLUMN_GAP * Math.max(0, groupLeaves[groupIndex].length - 1);
      if (isOnGroup) {
        const backing = figma.createFrame();
        backing.name = '#variants/grid/backing';
        backing.layoutMode = 'NONE';
        backing.fills = [makeSolidPaint(ctx.tokens.roles.bandFill.value, ctx.tokens.roles.bandFill.variable)];
        backing.cornerRadius = BACKING_RADIUS;
        backing.clipsContent = true;
        backing.resize(groupWidth + 2 * BODY_PAD, bodyHeight);
        grid.appendChild(backing);
        backing.x = groupsX[groupIndex] - BODY_PAD;
        backing.y = bodyTop;
        params.onDarkBackings.push(backing);
      }
    }
  });

  gridStep('instances', report.log, () => {
    for (let groupIndex = 0; groupIndex < outerValues.length; groupIndex += 1) {
      const outerValue = outerValues[groupIndex];
      const leafIndexes = groupLeaves[groupIndex];
      const isOnGroup = outerAxisIsOnDark && ON_VALUE_PATTERN.test(outerValue);
      const groupWidth = leafIndexes.reduce((total, index) => total + columnWidths[index], 0) + GRID_COLUMN_GAP * Math.max(0, leafIndexes.length - 1);

      let cellParent: FrameNode = grid;
      let originX = groupsX[groupIndex];
      let originY = bodyTop + BODY_PAD;
      if (params.syntheticDark?.enabled && isOnGroup) {
        const inner = figma.createFrame();
        inner.name = '#variants/grid/dark-inner';
        inner.layoutMode = 'NONE';
        inner.fills = [];
        inner.clipsContent = false;
        inner.resize(groupWidth, bodyHeight - 2 * BODY_PAD);
        grid.appendChild(inner);
        inner.x = originX;
        inner.y = originY;
        for (const collection of params.syntheticDark.darkCollections) setMode(inner, collection, params.syntheticDark.darkModeName, report);
        cellParent = inner;
        originX = 0;
        originY = 0;
      }

      let rowY = 0;
      effectiveRowCombos.forEach((rowCombo, rowIndex) => {
        let leafX = 0;
        for (const leafIndex of leafIndexes) {
          const combo = { ...columnCombos[leafIndex], ...rowCombo };
          const variant = match(combo);
          if (variant) {
            const instance = instantiate(cellParent, variant, params.booleans, report, columnWidths[leafIndex] - CELL_PAD);
            if (instance) {
              instance.x = originX + leafX;
              instance.y = originY + rowY + (rowHeights[rowIndex] - instance.height) / 2;
              genLog(report.log, 'log', '[gen] instance', variant.name, `${cellParent.name}`, Math.round(instance.x), Math.round(instance.y), Math.round(instance.width), Math.round(instance.height), instance.visible);
              if (instance.width < 8 || instance.height < 8 || !instance.visible) {
                report.warnings.push(`Instance of ${variant.name} is ${Math.round(instance.width)}×${Math.round(instance.height)}, visible=${instance.visible}.`);
              }
            }
          }
          leafX += columnWidths[leafIndex] + GRID_COLUMN_GAP;
        }
        rowY += rowHeights[rowIndex] + ROW_GAP;
      });
    }
  });

  gridStep('alignment check', report.log, () => {
    genLog(report.log, 'log', '[gen] grid align', { width: Math.round(grid.width), height: Math.round(grid.height), placed: placedIds.size });
  });
  return { node: grid, placed: placedIds.size, unplaced };
};

// ---------- Section builders (each returns skip reason or undefined) ----------

const fillVisualReference = (
  root: FrameNode,
  component: DocumentableNode,
  ctx: VisualContext,
  report: Phase5VisualReport,
): string | undefined => {
  const slot = prepareSlot(root, 'visual-reference');
  if (!slot) return 'slot not found';
  const base = getBaseComponent(component);
  if (!base) {
    addNote(slot, 'Visual reference unavailable.', ctx);
    return 'no base component';
  }
  const flow = wrapFrame('#visual-reference/flow');
  slot.appendChild(flow);
  setSizing(flow, 'FILL');
  const item = vFrame('#visual-reference/item');
  item.itemSpacing = 8;
  flow.appendChild(item);
  if (!instantiate(item, base, [], report, CONTENT_WIDTH)) {
    item.remove();
    addNote(slot, 'Visual reference unavailable.', ctx);
    return 'instance failed';
  }
  addText(item, base.name, 'caption', ctx, { color: 'textBody' });
  removePlaceholder(root, 'visual-reference');
  return undefined;
};

const fillVariants = (
  root: FrameNode,
  component: DocumentableNode,
  doc: ComponentDoc | null,
  ctx: VisualContext,
  report: Phase5VisualReport,
  defs: PropertyDef[],
  onDarkSource: 'property' | 'mode' | 'none',
  webCollections: VariableCollection[],
): string | undefined => {
  const slot = prepareSlot(root, 'variants');
  if (!slot) return 'slot not found';
  const variants = component.type === 'COMPONENT_SET'
    ? component.children.filter((child): child is ComponentNode => child.type === 'COMPONENT')
    : [];
  report.variantsTotal = variants.length > 0 ? variants.length : 1;
  const variantDefs = defs.filter((def) => def.type === 'VARIANT');
  genLog(report.log, 'log', '[gen] variants start', {
    type: component.type,
    variants: variants.length,
    variantProps: variantDefs.map((def) => stripHash(def.propertyName)),
    booleanProps: defs.filter((def) => def.type === 'BOOLEAN').map((def) => stripHash(def.propertyName)),
  });

  if (component.type !== 'COMPONENT_SET' || variants.length === 0) {
    const base = getBaseComponent(component);
    const flow = wrapFrame('#variants/flow');
    slot.appendChild(flow);
    setSizing(flow, 'FILL');
    const item = vFrame('#variants/item');
    item.itemSpacing = 8;
    flow.appendChild(item);
    if (base && instantiate(item, base, [], report, CONTENT_WIDTH)) {
      addText(item, base.name, 'caption', ctx, { color: 'textBody' });
      report.variantsPlaced = 1;
    } else {
      item.remove();
      addNote(slot, 'No variants found.', ctx);
    }
    return variants.length === 0 ? 'no variant children' : 'not a component set';
  }

  if (variantDefs.length === 0) {
    genLog(report.log, 'log', '[gen] variants skip', 'no VARIANT properties');
  }
  const plan = planGrid({
    properties: defs.map((def) => ({
      name: def.propertyName,
      type: def.type === 'BOOLEAN' ? 'BOOLEAN' : 'VARIANT',
      options: def.variantOptions,
      defaultValue: def.defaultValue !== undefined ? String(def.defaultValue) : undefined,
    })),
    variants: variants.map((variant) => ({
      name: variant.name,
      values: Object.fromEntries(variantDefs.map((def) => [def.propertyName, variantValue(variant, def.propertyName)])),
      x: variant.x,
      y: variant.y,
      width: variant.width,
      height: variant.height,
    })),
    onDarkSource,
    theme: null,
    contentWidth: CONTENT_WIDTH,
    labelColWidth: ROW_LABEL_COL_WIDTH,
    config: doc?.handoverConfig,
  });
  genLog(report.log, 'log', '[gen] variants axes', { columns: plan.columnAxes.map((axis) => stripHash(axis.name)), rows: plan.rowAxes.map((axis) => stripHash(axis.name)), onDarkSource });
  if (plan.placements.length === 0) {
    return `no placements: ${JSON.stringify({ columns: plan.columnAxes.map((axis) => axis.name), leaves: plan.leaves.length })}`;
  }

  // Synthetic On dark axis exists only when the component's on-dark source is "mode".
  const darkCollections = webCollections.filter((collection) => collection.modes.some((mode) => mode.name === 'Tesco dark mode'));
  const syntheticDark = onDarkSource === 'mode' && darkCollections.length > 0
    ? { enabled: true, darkCollections, darkModeName: 'Tesco dark mode' }
    : undefined;

  const grid = renderGrid(slot, variants, plan, {
    width: CONTENT_WIDTH,
    doc,
    booleans: [],
    onDarkBackings: report.onDarkBackings,
    syntheticDark,
  }, ctx, report);

  if (grid.placed === 0 || grid.node.width <= 0 || grid.node.height <= 0) {
    grid.node.remove();
    addNote(slot, "Couldn't build the grid: see console", ctx);
    const flow = wrapFrame('#variants/fallback');
    slot.appendChild(flow);
    setSizing(flow, 'FILL');
    for (const variant of variantsByPosition(variants)) {
      const item = vFrame('#variants/fallback-item');
      item.itemSpacing = 8;
      flow.appendChild(item);
      if (instantiate(item, variant, [], report, CONTENT_WIDTH)) addText(item, variant.name, 'caption', ctx, { color: 'textBody' });
      else item.remove();
    }
    report.variantsPlaced = variants.length;
    report.variantsOther = 0;
    return 'grid empty; fallback flow used';
  }

  report.variantsPlaced = grid.placed;
  report.variantsOther = grid.unplaced.length;
  if (grid.unplaced.length > 0) {
    addText(slot, 'Other variants', 'h3', ctx, { color: 'textBody' });
    const flow = wrapFrame('#variants/other');
    slot.appendChild(flow);
    setSizing(flow, 'FILL');
    for (const variant of variantsByPosition(grid.unplaced)) {
      const item = vFrame('#variants/other-item');
      item.itemSpacing = 8;
      flow.appendChild(item);
      if (instantiate(item, variant, [], report, CONTENT_WIDTH)) addText(item, variant.name, 'caption', ctx, { color: 'textBody' });
      else item.remove();
    }
  }
  genLog(report.log, 'log', '[gen] variants end', { placed: grid.placed, unplaced: grid.unplaced.length, instances: report.instanceCount });
  removePlaceholder(root, 'variants');
  return undefined;
};

const fillOnDark = async (
  root: FrameNode,
  component: DocumentableNode,
  doc: ComponentDoc | null,
  defs: PropertyDef[],
  ctx: VisualContext,
  report: Phase5VisualReport,
  onDarkSource: 'property' | 'mode' | 'none',
): Promise<string | undefined> => {
  void defs;
  void ctx;
  if (doc?.handoverConfig?.onDark === 'off') {
    removeSlot(root, 'on-dark');
    report.onDarkInfo = 'not available';
    return 'turned off in Handover layout';
  }
  if (onDarkSource === 'property') {
    removeSlot(root, 'on-dark');
    report.onDarkInfo = 'grid axis (property)';
    return 'on dark is a grid axis';
  }
  if (onDarkSource === 'none') {
    removeSlot(root, 'on-dark');
    report.onDarkInfo = 'not available';
    return 'no Tesco dark mode';
  }
  // Mode-based: the synthetic On dark axis lives inside the main grid; nothing separate to build.
  removeSlot(root, 'on-dark');
  report.onDarkInfo = 'mode-based (synthetic axis)';
  return 'synthetic axis in main grid';
};

const fillThemes = async (
  root: FrameNode,
  component: DocumentableNode,
  doc: ComponentDoc | null,
  defs: PropertyDef[],
  ctx: VisualContext,
  report: Phase5VisualReport,
  onDarkSource: 'property' | 'mode' | 'none',
  collections: VariableCollection[],
): Promise<string | undefined> => {
  if (doc?.handoverConfig?.themes === 'off') {
    removeSlot(root, 'theme');
    return 'turned off in Handover layout';
  }
  const slot = prepareSlot(root, 'theme');
  if (!slot) return 'slot not found';
  const variants = component.type === 'COMPONENT_SET'
    ? component.children.filter((child): child is ComponentNode => child.type === 'COMPONENT')
    : [];
  const variantDefs = defs.filter((def) => def.type === 'VARIANT');
  const base = getBaseComponent(component);
  const plannerInput = (theme: { name: string; hasDarkMode: boolean } | null) => ({
    properties: defs.map((def) => ({
      name: def.propertyName,
      type: def.type === 'BOOLEAN' ? 'BOOLEAN' as const : 'VARIANT' as const,
      options: def.variantOptions,
      defaultValue: def.defaultValue !== undefined ? String(def.defaultValue) : undefined,
    })),
    variants: variants.map((variant) => ({
      name: variant.name,
      values: Object.fromEntries(variantDefs.map((def) => [def.propertyName, variantValue(variant, def.propertyName)])),
      x: variant.x,
      y: variant.y,
      width: variant.width,
      height: variant.height,
    })),
    onDarkSource,
    theme,
    contentWidth: CONTENT_WIDTH,
    labelColWidth: ROW_LABEL_COL_WIDTH,
    config: doc?.handoverConfig,
  });
  const fullGridAffordable = variants.length > 0 && report.instanceCount + variants.length * THEME_MODES.length <= MAX_DOC_INSTANCES;
  if (!fullGridAffordable && variants.length > 0) {
    report.warnings.push(`Variants × (1 + themes) exceeds the ${MAX_DOC_INSTANCES} instance limit; themes show the default variant only.`);
  }

  let built = 0;
  for (const modeName of THEME_MODES) {
    const available = collections.filter((collection) => collection.modes.some((mode) => mode.name === modeName));
    if (available.length === 0) {
      genLog(report.log, 'log', '[gen] theme skip', modeName, 'mode not found');
      report.warnings.push(`Theme mode "${modeName}" not found in any Web collection; skipped.`);
      continue;
    }
    const darkModeName = themeDarkModeName(modeName);
    const darkAvailable = onDarkSource === 'mode'
      ? collections.filter((collection) => collection.modes.some((mode) => mode.name === darkModeName))
      : [];
    const section = vFrame(`#theme/${modeName}`);
    section.itemSpacing = SECTION_GAP;
    slot.appendChild(section);
    setSizing(section, 'FILL');
    addText(section, modeName, 'h3', ctx, { color: 'textBody' });

    if (variants.length === 0 || variantDefs.length === 0 || !fullGridAffordable) {
      const body = wrapFrame(`#theme/${modeName}/flow`);
      section.appendChild(body);
      setSizing(body, 'FILL');
      for (const collection of available) setMode(body, collection, modeName, report);
      const item = vFrame(`#theme/${modeName}/item`);
      item.itemSpacing = 8;
      body.appendChild(item);
      if (base && instantiate(item, base, [], report, CONTENT_WIDTH)) addText(item, base.name, 'caption', ctx, { color: 'textBody' });
      else item.remove();
      built += 1;
      continue;
    }

    const themeBackings: FrameNode[] = [];
    const plan = planGrid(plannerInput({ name: modeName, hasDarkMode: darkAvailable.length > 0 }));
    const grid = renderGrid(section, variants, plan, {
      width: CONTENT_WIDTH,
      doc,
      booleans: [],
      onDarkBackings: themeBackings,
      syntheticDark: darkAvailable.length > 0 ? { enabled: true, darkCollections: darkAvailable, darkModeName } : undefined,
    }, ctx, report);
    if (onDarkSource === 'mode' && darkAvailable.length === 0) {
      report.warnings.push(`Theme "${modeName}" has no dark mode ("${darkModeName}"); its grid has no on-dark axis.`);
    }
    if (grid.placed === 0) {
      grid.node.remove();
      addNote(section, "Couldn't build the grid: see console", ctx);
      continue;
    }
    // The absolute-coordinate grid holds bodies, backing and instances itself; the theme mode is
    // applied to the grid frame only — titles, headers and row labels keep the doc's mode.
    for (const collection of available) setMode(grid.node, collection, modeName, report);
    themeBackings.forEach((backing) => report.onDarkBackings.push(backing));

    // Theme check: read the mode from an instance inside the grid (not a header), mapped through
    // the collection that owns the bound variable. "unverified" when a mode id can't be mapped.
    const web = available.find((collection) => collection.name === WEB_COLLECTION_NAME) ?? available[0];
    const instance = grid.node.findAll((node) => node.type === 'INSTANCE')[0];
    let resolvedName = 'unverified';
    if (instance) {
      const instanceModes = (instance as InstanceNode).resolvedVariableModes;
      const modeId = instanceModes[web.id];
      resolvedName = web.modes.find((mode) => mode.modeId === modeId)?.name ?? 'unverified';
    }
    genLog(report.log, 'log', '[gen] theme modes', modeName, { instance: resolvedName });
    const ok = resolvedName === modeName;
    report.themeChecks.push(`${modeName}: Web resolved to ${resolvedName}${ok ? ' (ok)' : resolvedName === 'unverified' ? ' (unverified)' : ' (MISMATCH)'} · ${grid.placed} instances`);
    if (!ok && resolvedName !== 'unverified') report.warnings.push(`Theme "${modeName}" resolved to "${resolvedName}" on the grid; expected "${modeName}".`);
    built += 1;
  }
  return built === 0 ? 'no theme modes available' : (removePlaceholder(root, 'theme'), undefined);
};

const fillConfiguration = (
  root: FrameNode,
  component: DocumentableNode,
  ctx: VisualContext,
  report: Phase5VisualReport,
  defs: PropertyDef[],
): string | undefined => {
  const slot = clearSlot(root, 'configuration');
  if (!slot) return 'slot not found';
  const definitions = defs.filter((definition) => definition.type === 'BOOLEAN');
  if (definitions.length === 0) {
    addNote(slot, 'No Boolean properties.', ctx);
    return 'no Boolean properties';
  }
  const base = getBaseComponent(component);
  for (const definition of definitions) {
    const row = wrapFrame(`#configuration/${definition.propertyName}`);
    row.itemSpacing = GRID_COLUMN_GAP;
    slot.appendChild(row);
    setSizing(row, 'FILL');
    const label = vFrame(`#configuration/label/${definition.propertyName}`);
    label.itemSpacing = 8;
    row.appendChild(label);
    addText(label, stripHash(definition.propertyName), 'caption', ctx, { color: 'textBody' });
    for (const value of [false, true]) {
      const example = vFrame(`#configuration/${definition.propertyName}/${value}`);
      example.itemSpacing = 8;
      row.appendChild(example);
      addText(example, value ? 'On' : 'Off', 'caption', ctx, { color: 'textBody' });
      if (base) instantiate(example, base, [[definition.propertyName, value]], report);
    }
  }
  removePlaceholder(root, 'configuration');
  return undefined;
};

export const buildPhase5Visuals = async (
  root: FrameNode,
  component: DocumentableNode,
  doc: ComponentDoc | null,
  ctx: VisualContext,
): Promise<Phase5VisualReport> => {
  const report: Phase5VisualReport = {
    instanceCount: 0,
    gridCount: 0,
    warnings: [],
    sections: [],
    log: [],
    themeChecks: [],
    variantsPlaced: 0,
    variantsTotal: 0,
    variantsOther: 0,
    onDarkInfo: 'not available',
    onDarkBackings: [],
  };
  const defs = propertyDefs(component);
  setSizingLogger((level, ...args) => genLog(report.log, level, ...args));
  genLog(report.log, 'log', '[gen] start', { component: component.name, type: component.type });

  // Decide once per component, before any grid: property beats mode beats none.
  const onDarkIsProperty = defs.some((def) =>
    (def.type === 'VARIANT' || def.type === 'BOOLEAN') && ON_DARK_PATTERN.test(stripHash(def.propertyName)));
  const webCollections = await getWebCollections(report);
  const hasTescoDark = webCollections.some((collection) => collection.modes.some((mode) => mode.name === 'Tesco dark mode'));
  const onDarkSource: 'property' | 'mode' | 'none' = onDarkIsProperty ? 'property' : hasTescoDark ? 'mode' : 'none';
  genLog(report.log, 'log', '[gen] onDarkSource', onDarkSource);

  const content = (key: string): FrameNode | null => {
    const section = root.findAll((node) => node.name === `#section/${key}/content`)[0];
    return section && section.type === 'FRAME' ? section : null;
  };

  // Sections run strictly one after another, each awaited before the next starts.
  const builders: Array<[string, () => Promise<string | undefined> | string | undefined, FrameNode | null]> = [
    ['visual-reference', () => fillVisualReference(root, component, ctx, report), content('visual-reference')],
    ['variants', () => fillVariants(root, component, doc, ctx, report, defs, onDarkSource, webCollections), content('variants')],
    ['on-dark', () => fillOnDark(root, component, doc, defs, ctx, report, onDarkSource), content('variants')],
    ['themes', () => fillThemes(root, component, doc, defs, ctx, report, onDarkSource, webCollections), content('smaller-theme')],
    ['configuration', () => fillConfiguration(root, component, ctx, report, defs), content('configuration-behaviour')],
  ];
  for (const [name, build, container] of builders) {
    report.sections.push(await runSectionAsync(name, build, container, ctx, report.log));
  }

  // Placed-vs-total: with a synthetic On dark axis each variant legitimately appears once per
  // synthetic group, so the expectation counts distinct variants, not instances.
  const expectedVariants = report.variantsTotal;
  if (expectedVariants > 0 && report.variantsPlaced < expectedVariants) {
    report.warnings.push(`variants: ok but placed ${report.variantsPlaced} of ${expectedVariants}`);
  }

  // On-dark backings inherit the doc root's Tesco mode; log and warn on dark modes.
  if (report.onDarkBackings.length > 0) {
    const collections = await getWebCollections(report);
    for (const backing of report.onDarkBackings) {
      const names = modeNamesOf(backing, collections);
      genLog(report.log, 'log', '[gen] on-dark backing modes', backing.name, names);
      const dark = names.find((name) => /dark/i.test(name));
      if (dark) report.warnings.push(`On dark backing resolved in ${dark}`);
    }
  }

  // Item 2: only slots whose section reported "ok" may be flagged for a remaining placeholder.
  const okSections = new Set(report.sections.filter((section) => section.status === 'ok').map((section) => section.name));
  const builtSlots: Array<[string, string]> = [
    ['visual-reference', 'visual-reference'],
    ['variants', 'variants'],
    ['themes', 'theme'],
    ['configuration', 'configuration'],
  ];
  for (const [sectionName, key] of builtSlots) {
    if (!okSections.has(sectionName)) continue;
    const slot = root.findAll((node) => node.type === 'FRAME' && node.name === `#slot/${key}`)[0];
    if (slot && slot.type === 'FRAME') {
      const hasPlaceholder = slot.children.some((child) => child.type === 'TEXT' && child.characters.startsWith('Auto-generated in Phase'));
      if (hasPlaceholder) {
        report.warnings.push(`Slot not filled: ${key}`);
        report.sections.push({ name: `slot/${key}`, status: 'failed', reason: 'placeholder remains', durationMs: 0 });
      }
    }
  }

  genLog(report.log, 'log', '[gen] end', { grids: report.gridCount, variants: report.variantsTotal, instances: report.instanceCount });
  return report;
};
