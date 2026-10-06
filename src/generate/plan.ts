/**
 * Pure grid planner. No Figma types or globals — it takes plain data and returns a GridPlan.
 * renderGrid draws a plan; it never decides axes, order or placement.
 */
import {
  ON_DARK_PROPERTY_PATTERN,
  ON_VALUE_PATTERN,
  STATE_PROPERTY_PATTERN,
  SYNTHETIC_ON_DARK,
} from './config';

export interface PlannerProperty {
  name: string;
  type: 'VARIANT' | 'BOOLEAN';
  options: string[];
  defaultValue?: string;
}

export interface PlannerVariant {
  name: string;
  values: Record<string, string>;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlannerInput {
  properties: PlannerProperty[];
  variants: PlannerVariant[];
  onDarkSource: 'property' | 'mode' | 'none';
  onDarkProperty?: string;
  theme: { name: string; hasDarkMode: boolean } | null;
  contentWidth: number;
  labelColWidth: number;
  config?: {
    axes?: Record<string, 'auto' | 'columns' | 'rows'>;
    labels?: Record<string, string>;
    reverse?: Record<string, boolean>;
  };
}

export interface Axis {
  name: string;
  synthetic: boolean;
  values: string[];
}

export interface GridPlacement {
  variantName: string;
  groupIndex: number;
  leafIndex: number;
  rowIndex: number;
}

export interface GridPlan {
  columnAxes: Axis[];
  rowAxes: Axis[];
  groups: Array<{ value: string; leafIndexes: number[] }>;
  leaves: Array<{ values: Record<string, string>; variantName: string | null }>;
  rows: Array<{ values: Record<string, string> }>;
  blocks: number[][];
  placements: GridPlacement[];
  toggles: string[];
  warnings: string[];
}

const CELL_PAD = 32;
const MIN_COLUMN_WIDTH = 96;
const GRID_COLUMN_GAP = 40;
const POSITION_TOLERANCE = 4;
const MAX_COLUMN_AXES = 2;
const MAX_ROW_AXES = 3;

const stripHash = (name: string) => name.replace(/#.*$/, '');

/** Design order: first appearance by position, else default-first then option order. */
const designOrder = (
  variants: PlannerVariant[],
  axis: string,
  options: string[],
  defaultValue: string | undefined,
  direction: 'columns' | 'rows',
  reverse: boolean,
): string[] => {
  const present = [...new Set(variants.map((variant) => variant.values[axis] ?? ''))];
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
    const value = variant.values[axis] ?? '';
    if (!byPosition.includes(value)) byPosition.push(value);
  }
  const separates = present.every((value) => {
    const positions = variants.filter((variant) => (variant.values[axis] ?? '') === value).map((variant) => (direction === 'columns' ? variant.x : variant.y));
    const min = Math.min(...positions);
    const max = Math.max(...positions);
    return present.every((other) => {
      if (other === value) return true;
      const otherPositions = variants.filter((variant) => (variant.values[axis] ?? '') === other).map((variant) => (direction === 'columns' ? variant.x : variant.y));
      return Math.max(...otherPositions) + POSITION_TOLERANCE <= min || max + POSITION_TOLERANCE <= Math.min(...otherPositions);
    });
  });
  let ordered: string[];
  if (separates && byPosition.length === present.length) {
    ordered = byPosition;
  } else {
    ordered = [
      ...(defaultValue && present.includes(defaultValue) ? [defaultValue] : []),
      ...options.filter((option) => present.includes(option) && option !== defaultValue),
      ...present.filter((value) => !options.includes(value) && value !== defaultValue),
    ];
  }
  return reverse ? [...ordered].reverse() : ordered;
};

const combosFor = (axes: Axis[]): Array<Record<string, string>> => {
  if (axes.length === 0) return [];
  const result: Array<Record<string, string>> = [];
  const walk = (index: number, acc: Record<string, string>) => {
    if (index === axes.length) {
      result.push({ ...acc });
      return;
    }
    for (const value of axes[index].values) {
      acc[axes[index].name] = value;
      walk(index + 1, acc);
    }
    delete acc[axes[index].name];
  };
  walk(0, {});
  return result;
};

export const planGrid = (input: PlannerInput): GridPlan => {
  const warnings: string[] = [];
  const softAssert = (condition: boolean, message: string) => {
    if (!condition) warnings.push(message);
  };
  const variantProps = input.properties.filter((property) => property.type === 'VARIANT');
  const toggles = input.properties.filter((property) => property.type === 'BOOLEAN').map((property) => property.name);
  const config = input.config ?? {};

  // Axis assignment: on dark first, state-like next, fewest options, caps.
  const optionCount = (name: string) => variantProps.find((property) => property.name === name)?.options.length ?? 0;
  const columns: string[] = [];
  const rows: string[] = [];
  const pool: string[] = [];
  for (const property of variantProps) {
    const override = config.axes?.[property.name];
    if (override === 'columns') columns.push(property.name);
    else if (override === 'rows') rows.push(property.name);
    else pool.push(property.name);
  }
  const darkIndex = pool.findIndex((name) => ON_DARK_PROPERTY_PATTERN.test(stripHash(name)));
  if (darkIndex >= 0) columns.unshift(pool.splice(darkIndex, 1)[0]);
  const stateIndex = pool.findIndex((name) => STATE_PROPERTY_PATTERN.test(stripHash(name)));
  if (stateIndex >= 0) columns.push(pool.splice(stateIndex, 1)[0]);
  const remaining = pool.sort((a, b) => optionCount(a) - optionCount(b));
  while (columns.length < MAX_COLUMN_AXES && remaining.length > 0) columns.push(remaining.shift() as string);
  rows.push(...remaining);

  const seen = new Set<string>();
  for (const axis of [...columns, ...rows]) {
    softAssert(!seen.has(axis), `axis duplicated: ${stripHash(axis)}`);
    seen.add(axis);
  }

  const makeAxis = (name: string, direction: 'columns' | 'rows'): Axis => {
    const property = variantProps.find((entry) => entry.name === name);
    return {
      name,
      synthetic: false,
      values: designOrder(input.variants, name, property?.options ?? [], property?.defaultValue, direction, Boolean(config.reverse?.[name])),
    };
  };

  let columnAxes = columns.slice(0, MAX_COLUMN_AXES).map((name) => makeAxis(name, 'columns'));
  let rowAxes = rows.slice(0, MAX_ROW_AXES).map((name) => makeAxis(name, 'rows'));

  // Synthetic On dark axis: only when onDarkSource is "mode". Values are its own; never a property.
  if (input.onDarkSource === 'mode') {
    const synthetic: Axis = {
      name: SYNTHETIC_ON_DARK,
      synthetic: true,
      values: input.theme && !input.theme.hasDarkMode ? ['No'] : ['No', 'Yes'],
    };
    columnAxes = [synthetic, ...columnAxes.slice(0, MAX_COLUMN_AXES - 1)];
  }

  // Never zero columns when there is at least one variant: a synthetic "Variant" axis holds them.
  if (columnAxes.length === 0 && input.variants.length > 0) {
    columnAxes = [{
      name: 'Variant',
      synthetic: true,
      values: input.variants.length === 1
        ? [input.variants[0].name]
        : variantsInPositionOrder(input.variants).map((entry) => entry.name),
    }];
  }

  // Placement: each variant in every synthetic group as its own instance.
  const columnCombos = combosFor(columnAxes);
  const rowCombos = combosFor(rowAxes);
  const effectiveRows: Array<Record<string, string>> = rowAxes.length === 0 ? [{}] : rowCombos;
  const fallbackAxis = columnAxes.length === 1 && columnAxes[0].synthetic && columnAxes[0].name === 'Variant' ? columnAxes[0] : null;
  const leaves = columnCombos.map((combo) => {
    const variant = fallbackAxis
      ? input.variants.find((entry) => entry.name === combo[fallbackAxis.name]) ?? null
      : input.variants.find((entry) =>
          columnAxes.filter((axis) => !axis.synthetic).every((axis) => (entry.values[axis.name] ?? '') === combo[axis.name])) ?? null;
    return { values: combo, variantName: variant?.name ?? null };
  });

  const leafValueCount = (axis: Axis) => Math.max(1, axis.values.length);
  const expectedLeaves = columnAxes.reduce((product, axis) => product * leafValueCount(axis), 1);
  softAssert(leaves.length === expectedLeaves, `leaf count mismatch: expected ${expectedLeaves}, got ${leaves.length}`);

  const groups: GridPlan['groups'] = [];
  const outerAxis = columnAxes[0];
  if (outerAxis) {
    const outerValues = [...new Set(leaves.map((leaf) => leaf.values[outerAxis.name]))];
    for (const value of outerValues) {
      const leafIndexes = leaves.map((_, index) => index).filter((index) => leaves[index].values[outerAxis.name] === value);
      groups.push({ value, leafIndexes });
    }
  } else {
    groups.push({ value: '', leafIndexes: leaves.map((_, index) => index) });
  }

  const placements: GridPlacement[] = [];
  leaves.forEach((leaf, leafIndex) => {
    const groupIndex = groups.findIndex((group) => group.leafIndexes.includes(leafIndex));
    effectiveRows.forEach((row, rowIndex) => {
      const variant = input.variants.find((entry) =>
        columnAxes.filter((axis) => !axis.synthetic).every((axis) => (entry.values[axis.name] ?? '') === leaf.values[axis.name])
        && rowAxes.every((axis) => (entry.values[axis.name] ?? '') === row[axis.name]));
      if (variant) placements.push({ variantName: variant.name, groupIndex, leafIndex, rowIndex });
    });
  });

  // Fit rule: demote the innermost column axis while the grid exceeds the content width.
  const widthOf = (leaf: { values: Record<string, string>; variantName: string | null }) => {
    const variant = input.variants.find((entry) => entry.name === leaf.variantName);
    return Math.max(MIN_COLUMN_WIDTH, (variant?.width ?? 1) + CELL_PAD);
  };
  const totalWidth = () => leaves.reduce((total, leaf) => total + widthOf(leaf), 0) + GRID_COLUMN_GAP * Math.max(0, leaves.length - 1);
  if (columnAxes.filter((axis) => !axis.synthetic).length > 1 && totalWidth() > input.contentWidth) {
    const demoted = columnAxes[columnAxes.length - 1];
    if (!demoted.synthetic) {
      return planGrid({ ...input, config: { ...config, axes: { ...config.axes, [demoted.name]: 'rows' } } });
    }
  }

  // Blocks: split leaf columns that don't fit.
  const blocks: number[][] = [];
  let block: number[] = [];
  let blockWidth = 0;
  leaves.forEach((leaf, index) => {
    const cost = block.length === 0 ? widthOf(leaf) : widthOf(leaf) + GRID_COLUMN_GAP;
    if (block.length > 0 && blockWidth + cost > input.contentWidth) {
      blocks.push(block);
      block = [index];
      blockWidth = widthOf(leaf);
    } else {
      block.push(index);
      blockWidth += cost;
    }
  });
  if (block.length > 0) blocks.push(block);

  return {
    columnAxes,
    rowAxes,
    groups,
    leaves,
    rows: effectiveRows.map((values) => ({ values })),
    blocks,
    placements,
    toggles,
    warnings,
  };
};

const variantsInPositionOrder = (variants: PlannerVariant[]): PlannerVariant[] =>
  [...variants].sort((a, b) => (Math.abs(a.x - b.x) > POSITION_TOLERANCE ? a.x - b.x : a.y - b.y));
