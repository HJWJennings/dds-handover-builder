export const DOC_WIDTH = 1600;
export const CONTENT_WIDTH = 1520;
export const PAGE_PADDING = 40;
export const PAGE_GAP = 200;
export const ROOT_SECTION_GAP = 0;
export const FRAME_MIN_HEIGHT = 1;

export const HEADER_VERTICAL_PADDING = 80;
export const HEADER_TEXT_GAP = 8;
export const HEADER_BAND_GAP = 0;

export const GLANCE_COLUMNS = 5;
export const GLANCE_HORIZONTAL_PADDING = PAGE_PADDING;
export const GLANCE_VERTICAL_PADDING = 24;
export const GLANCE_COLUMN_GAP = 20;
export const GLANCE_ITEM_TEXT_GAP = 4;

export const SECTION_PADDING = 40;
export const SECTION_GAP = 24;
export const CELL_PADDING = 16;
export const ROW_LABEL_WIDTH = 200;
export const PANEL_PADDING = 40;
export const GRID_ROW_GAP = 24;
export const GRID_COLUMN_GAP = 40;
export const GRID_BLOCK_GAP = 48;
export const MAX_DOC_INSTANCES = 200;
export const SLOT_PADDING = 24;
export const DIVIDER_HEIGHT = 1;
export const SLOT_STROKE_WEIGHT = 1;
export const SLOT_DASH_PATTERN = [6, 4] as const;
export const CODE_BLOCK_PADDING = 12;
export const CODE_BLOCK_GAP = 0;
export const CODE_BLOCK_FONT_SIZE = 16;
export const LAYOUT_CHECK_MIN_TEXT_WIDTH = 40;
export const LAYOUT_CHECK_MIN_PARENT_FRACTION = 0.25;
export const SPACING_VALUES = [4, 8, 12, 16, 20, 24, 40] as const;
export const SECTION_NUMBERS = false;

/**
 * Guarded sizing, per axis, never throws:
 *  - FIXED: always set.
 *  - HUG: only a FRAME with layoutMode ≠ NONE, or a TEXT whose parent is auto layout.
 *    Otherwise downgraded to FIXED (current size kept).
 *  - FILL: only when the parent is auto layout and the node isn't ABSOLUTE.
 *    Otherwise downgraded to FIXED.
 * Downgrades and errors are logged via the injected logger with the caller's stack line.
 */
export type GenLogger = (level: 'log' | 'warn' | 'error', ...args: unknown[]) => void;
let sizingLogger: GenLogger = (level, ...args) => {
  if (level === 'warn') console.warn(...args);
  else if (level === 'error') console.error(...args);
  else console.log(...args);
};
export const setSizingLogger = (logger: GenLogger): void => {
  sizingLogger = logger;
};

const callerLine = (): string => {
  const stack = new Error().stack ?? '';
  return stack.split('\n')[3]?.trim() ?? 'unknown caller';
};

export const setSizing = (
  node: SceneNode,
  horizontal?: 'FIXED' | 'HUG' | 'FILL',
  vertical?: 'FIXED' | 'HUG' | 'FILL',
): void => {
  const isAutoFrame = node.type === 'FRAME' && node.layoutMode !== 'NONE';
  const parent = node.parent;
  const parentIsAuto = Boolean(parent && parent.type === 'FRAME' && (parent as FrameNode).layoutMode !== 'NONE');
  const target = node as FrameNode | InstanceNode | TextNode;

  const apply = (axis: 'Horizontal' | 'Vertical', requested: 'FIXED' | 'HUG' | 'FILL' | undefined) => {
    if (!requested) return;
    let value = requested;
    if (requested === 'HUG' && !isAutoFrame && !(node.type === 'TEXT' && parentIsAuto)) {
      value = 'FIXED';
      sizingLogger('warn', 'sizing downgraded', node.name, node.type, axis, requested, 'parent:', parent?.name, parent && parent.type === 'FRAME' ? (parent as FrameNode).layoutMode : parent?.type, callerLine());
    }
    if (requested === 'FILL' && (!parentIsAuto || (node as { layoutPositioning?: string }).layoutPositioning === 'ABSOLUTE')) {
      value = 'FIXED';
      sizingLogger('warn', 'sizing downgraded', node.name, node.type, axis, requested, 'parent:', parent?.name, parent && parent.type === 'FRAME' ? (parent as FrameNode).layoutMode : parent?.type, callerLine());
    }
    try {
      if (axis === 'Horizontal') target.layoutSizingHorizontal = value;
      else target.layoutSizingVertical = value;
    } catch (error) {
      sizingLogger('warn', 'sizing downgraded', node.name, node.type, axis, requested, 'parent:', parent?.name, parent && parent.type === 'FRAME' ? (parent as FrameNode).layoutMode : parent?.type, callerLine(), error instanceof Error ? error.message : String(error));
    }
  };

  apply('Horizontal', horizontal);
  apply('Vertical', vertical);
};

export const TEXT_SCALE = {
  category: { size: 16, lineHeight: 24 },
  title: { size: 56, lineHeight: 68, bold: true },
  summary: { size: 20, lineHeight: 28 },
  heading: { size: 32, lineHeight: 44, bold: true },
  h3: { size: 24, lineHeight: 32, bold: true },
  body: { size: 20, lineHeight: 28 },
  caption: { size: 16, lineHeight: 24 },
  footer: { size: 16, lineHeight: 24 },
} as const;
