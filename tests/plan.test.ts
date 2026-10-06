import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGrid, type PlannerInput, type PlannerVariant } from '../src/generate/plan.ts';

const variant = (name: string, values: Record<string, string>, x: number, y: number, width = 107, height = 40): PlannerVariant =>
  ({ name, values, x, y, width, height });

const base = (overrides: Partial<PlannerInput>): PlannerInput => ({
  properties: [],
  variants: [],
  onDarkSource: 'none',
  theme: null,
  contentWidth: 1520,
  labelColWidth: 160,
  ...overrides,
});

test('a) AI FAB: 3 VARIANT properties, on-dark property, 8 variants', () => {
  const plan = planGrid(base({
    properties: [
      { name: 'On dark#1', type: 'VARIANT', options: ['No', 'Yes'], defaultValue: 'No' },
      { name: 'Focused#2', type: 'VARIANT', options: ['False', 'True'], defaultValue: 'False' },
      { name: 'With label#3', type: 'VARIANT', options: ['No', 'Yes'], defaultValue: 'Yes' },
    ],
    variants: [
      variant('Yes/False/Yes', { 'On dark#1': 'Yes', 'Focused#2': 'False', 'With label#3': 'Yes' }, 0, 0),
      variant('No/False/Yes', { 'On dark#1': 'No', 'Focused#2': 'False', 'With label#3': 'Yes' }, 200, 0),
      variant('Yes/True/Yes', { 'On dark#1': 'Yes', 'Focused#2': 'True', 'With label#3': 'Yes' }, 0, 100),
      variant('No/True/Yes', { 'On dark#1': 'No', 'Focused#2': 'True', 'With label#3': 'Yes' }, 200, 100),
      variant('Yes/False/No', { 'On dark#1': 'Yes', 'Focused#2': 'False', 'With label#3': 'No' }, 0, 200),
      variant('No/False/No', { 'On dark#1': 'No', 'Focused#2': 'False', 'With label#3': 'No' }, 200, 200),
      variant('Yes/True/No', { 'On dark#1': 'Yes', 'Focused#2': 'True', 'With label#3': 'No' }, 0, 300),
      variant('No/True/No', { 'On dark#1': 'No', 'Focused#2': 'True', 'With label#3': 'No' }, 200, 300),
    ],
    onDarkSource: 'property',
  }));
  assert.deepEqual(plan.columnAxes.map((axis) => axis.name), ['On dark#1', 'Focused#2']);
  assert.deepEqual(plan.rowAxes.map((axis) => axis.name), ['With label#3']);
  assert.equal(plan.leaves.length, 4);
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.placements.length, 8);
  assert.ok(plan.columnAxes[0].values.length > 0);
});

test('b) AI disclaimer main grid: synthetic On dark, no rows', () => {
  const plan = planGrid(base({
    properties: [{ name: 'Variant#1', type: 'VARIANT', options: ['Full', 'Basic'], defaultValue: 'Full' }],
    variants: [
      variant('Full', { 'Variant#1': 'Full' }, 0, 0, 700, 60),
      variant('Basic', { 'Variant#1': 'Basic' }, 800, 0, 700, 60),
    ],
    onDarkSource: 'mode',
  }));
  assert.deepEqual(plan.columnAxes.map((axis) => axis.name), ['On dark', 'Variant#1']);
  assert.equal(plan.columnAxes[0].synthetic, true);
  assert.deepEqual(plan.columnAxes[0].values, ['No', 'Yes']);
  assert.equal(plan.rowAxes.length, 0);
  assert.equal(plan.leaves.length, 4);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.placements.length, 4);
});

test('c) disclaimer in Lo-Fi: no dark mode, single No group', () => {
  const plan = planGrid(base({
    properties: [{ name: 'Variant#1', type: 'VARIANT', options: ['Full', 'Basic'], defaultValue: 'Full' }],
    variants: [
      variant('Full', { 'Variant#1': 'Full' }, 0, 0, 700, 60),
      variant('Basic', { 'Variant#1': 'Basic' }, 800, 0, 700, 60),
    ],
    onDarkSource: 'mode',
    theme: { name: 'Lo-Fi', hasDarkMode: false },
  }));
  assert.deepEqual(plan.columnAxes[0].values, ['No']);
  assert.equal(plan.leaves.length, 2);
  assert.equal(plan.placements.length, 2);
});

test('d) standalone component, no variants', () => {
  const plan = planGrid(base({
    variants: [variant('Only', {}, 0, 0)],
  }));
  assert.equal(plan.leaves.length, 1);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.placements.length, 1);
  assert.equal(plan.columnAxes.length + plan.rowAxes.length >= 0, true);
});

test('e) one VARIANT property with 2 options', () => {
  const plan = planGrid(base({
    properties: [{ name: 'Size#1', type: 'VARIANT', options: ['S', 'M'], defaultValue: 'S' }],
    variants: [variant('S', { 'Size#1': 'S' }, 0, 0), variant('M', { 'Size#1': 'M' }, 200, 0)],
  }));
  assert.ok(plan.columnAxes.length > 0);
  assert.equal(plan.leaves.length, 2);
  assert.equal(plan.placements.length, 2);
});

test('f) user chat bubble: 1 VARIANT + 3 BOOLEAN', () => {
  const plan = planGrid(base({
    properties: [
      { name: 'Width#1', type: 'VARIANT', options: ['Narrow', 'Wide'], defaultValue: 'Narrow' },
      { name: 'Tail#2', type: 'BOOLEAN', options: [], defaultValue: 'true' },
      { name: 'Avatar#3', type: 'BOOLEAN', options: [], defaultValue: 'false' },
      { name: 'Status#4', type: 'BOOLEAN', options: [], defaultValue: 'false' },
    ],
    variants: [variant('Narrow', { 'Width#1': 'Narrow' }, 0, 0), variant('Wide', { 'Width#1': 'Wide' }, 300, 0)],
  }));
  assert.equal(plan.leaves.length, 2);
  assert.deepEqual(plan.toggles, ['Tail#2', 'Avatar#3', 'Status#4']);
});

test('g) state-like columns, fewest-options rows via fit rule', () => {
  const plan = planGrid(base({
    properties: [
      { name: 'State#1', type: 'VARIANT', options: ['Default', 'Hover', 'Pressed', 'Disabled'], defaultValue: 'Default' },
      { name: 'Size#2', type: 'VARIANT', options: ['S', 'M', 'L'], defaultValue: 'M' },
    ],
    variants: [
      variant('Default/S', { 'State#1': 'Default', 'Size#2': 'S' }, 0, 0, 400, 40),
      variant('Hover/S', { 'State#1': 'Hover', 'Size#2': 'S' }, 450, 0, 400, 40),
      variant('Pressed/S', { 'State#1': 'Pressed', 'Size#2': 'S' }, 900, 0, 400, 40),
      variant('Disabled/S', { 'State#1': 'Disabled', 'Size#2': 'S' }, 1350, 0, 400, 40),
      variant('Default/M', { 'State#1': 'Default', 'Size#2': 'M' }, 0, 100, 400, 40),
      variant('Hover/M', { 'State#1': 'Hover', 'Size#2': 'M' }, 450, 100, 400, 40),
      variant('Pressed/M', { 'State#1': 'Pressed', 'Size#2': 'M' }, 900, 100, 400, 40),
      variant('Disabled/M', { 'State#1': 'Disabled', 'Size#2': 'M' }, 1350, 100, 400, 40),
      variant('Default/L', { 'State#1': 'Default', 'Size#2': 'L' }, 0, 200, 400, 40),
      variant('Hover/L', { 'State#1': 'Hover', 'Size#2': 'L' }, 450, 200, 400, 40),
      variant('Pressed/L', { 'State#1': 'Pressed', 'Size#2': 'L' }, 900, 200, 400, 40),
      variant('Disabled/L', { 'State#1': 'Disabled', 'Size#2': 'L' }, 1350, 200, 400, 40),
    ],
  }));
  // 4 state columns × 432px exceeds content width, so Size demotes to rows.
  assert.deepEqual(plan.columnAxes.map((axis) => axis.name), ['State#1']);
  assert.deepEqual(plan.rowAxes.map((axis) => axis.name), ['Size#2']);
});

test('h) 12-option property never yields zero columns', () => {
  const many = Array.from({ length: 12 }, (_, index) => `Opt${index + 1}`);
  const plan = planGrid(base({
    properties: [
      { name: 'Many#1', type: 'VARIANT', options: many, defaultValue: 'Opt1' },
      { name: 'Wide#2', type: 'VARIANT', options: ['A', 'B'], defaultValue: 'A' },
    ],
    variants: many.flatMap((option, index) => [
      variant(`${option}/A`, { 'Many#1': option, 'Wide#2': 'A' }, index * 120, 0, 100, 40),
      variant(`${option}/B`, { 'Many#1': option, 'Wide#2': 'B' }, index * 120, 100, 750, 40),
    ]),
  }));
  assert.ok(plan.columnAxes.length > 0);
  assert.ok(plan.placements.length > 0);
});

test('i) 3 VARIANT properties + On dark', () => {
  const plan = planGrid(base({
    properties: [
      { name: 'On dark#1', type: 'VARIANT', options: ['No', 'Yes'], defaultValue: 'No' },
      { name: 'A#2', type: 'VARIANT', options: ['1', '2'], defaultValue: '1' },
      { name: 'B#3', type: 'VARIANT', options: ['x', 'y'], defaultValue: 'x' },
      { name: 'C#4', type: 'VARIANT', options: ['p', 'q'], defaultValue: 'p' },
    ],
    variants: [
      variant('No/1/x/p', { 'On dark#1': 'No', 'A#2': '1', 'B#3': 'x', 'C#4': 'p' }, 0, 0),
      variant('Yes/1/x/p', { 'On dark#1': 'Yes', 'A#2': '1', 'B#3': 'x', 'C#4': 'p' }, 200, 0),
      variant('No/2/x/p', { 'On dark#1': 'No', 'A#2': '2', 'B#3': 'x', 'C#4': 'p' }, 400, 0),
      variant('Yes/2/x/p', { 'On dark#1': 'Yes', 'A#2': '2', 'B#3': 'x', 'C#4': 'p' }, 600, 0),
      variant('No/1/y/q', { 'On dark#1': 'No', 'A#2': '1', 'B#3': 'y', 'C#4': 'q' }, 0, 100),
      variant('Yes/1/y/q', { 'On dark#1': 'Yes', 'A#2': '1', 'B#3': 'y', 'C#4': 'q' }, 200, 100),
      variant('No/2/y/q', { 'On dark#1': 'No', 'A#2': '2', 'B#3': 'y', 'C#4': 'q' }, 400, 100),
      variant('Yes/2/y/q', { 'On dark#1': 'Yes', 'A#2': '2', 'B#3': 'y', 'C#4': 'q' }, 600, 100),
    ],
    onDarkSource: 'property',
  }));
  assert.equal(plan.columnAxes[0].name, 'On dark#1');
  assert.ok(plan.placements.length > 0);
});

test('j) variants at the same position fall back to default-first order', () => {
  const plan = planGrid(base({
    properties: [{ name: 'Kind#1', type: 'VARIANT', options: ['Zeta', 'Alpha', 'Mid'], defaultValue: 'Mid' }],
    variants: [
      variant('Zeta', { 'Kind#1': 'Zeta' }, 0, 0),
      variant('Alpha', { 'Kind#1': 'Alpha' }, 0, 0),
      variant('Mid', { 'Kind#1': 'Mid' }, 0, 0),
    ],
  }));
  const order = plan.columnAxes[0]?.values ?? plan.rowAxes[0]?.values ?? [];
  assert.equal(order[0], 'Mid');
});

test('k) reverse and axes overrides', () => {
  const plan = planGrid(base({
    properties: [
      { name: 'A#1', type: 'VARIANT', options: ['1', '2'], defaultValue: '1' },
      { name: 'B#2', type: 'VARIANT', options: ['x', 'y'], defaultValue: 'x' },
    ],
    variants: [
      variant('1/x', { 'A#1': '1', 'B#2': 'x' }, 0, 0),
      variant('2/x', { 'A#1': '2', 'B#2': 'x' }, 200, 0),
      variant('1/y', { 'A#1': '1', 'B#2': 'y' }, 0, 100),
      variant('2/y', { 'A#1': '2', 'B#2': 'y' }, 200, 100),
    ],
    config: { axes: { 'B#2': 'columns', 'A#1': 'rows' }, reverse: { 'B#2': true } },
  }));
  assert.deepEqual(plan.columnAxes.map((axis) => axis.name), ['B#2']);
  assert.deepEqual(plan.rowAxes.map((axis) => axis.name), ['A#1']);
  assert.deepEqual(plan.columnAxes[0].values, ['y', 'x']);
});
