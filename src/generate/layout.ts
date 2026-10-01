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
