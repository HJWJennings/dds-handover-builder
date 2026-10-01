import { resolveVariableMetadata, serializeBoundVariables, type ErrorCollector } from './inspect';

export const TOKEN_COLLECTIONS = ['Web', 'Web brand 2026', 'Collection 1'] as const;

const STYLE_PROBE_MAX_NODES = 120;
const HEX = (rgb: { r: number; g: number; b: number }) =>
  `#${[rgb.r, rgb.g, rgb.b].map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

interface ProbeStats {
  nodesUsingStyles: Set<string>;
  hardCodedPaints: number;
  nodesUsingVariables: Set<string>;
  fonts: Set<string>;
  styleNames: Set<string>;
}

interface ProbeContext {
  collector: ErrorCollector;
  stats: ProbeStats;
  variables: Set<string>;
  visited: Set<string>;
  examined: Set<string>;
  truncated: boolean;
}

const reserveNode = (node: BaseNode, context: ProbeContext): boolean => {
  if (context.examined.has(node.id)) return true;
  if (context.examined.size >= STYLE_PROBE_MAX_NODES) {
    context.truncated = true;
    return false;
  }
  context.examined.add(node.id);
  return true;
};

const safeRead = async <T>(context: ProbeContext, label: string, read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch (error) {
    context.collector.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

const resolveStyleName = async (styleId: unknown, context: ProbeContext, label: string): Promise<string | null> => {
  if (typeof styleId !== 'string' || styleId.length === 0) return null;
  const style = await safeRead(context, label, () => figma.getStyleByIdAsync(styleId));
  if (!style) return null;
  context.stats.styleNames.add(style.name);
  return style.name;
};

const getAliasData = async (aliasValue: unknown, context: ProbeContext, label: string) => {
  const alias = aliasValue as { id?: string } | null;
  if (!alias?.id) return null;
  const resolved = await safeRead(context, label, () => resolveVariableMetadata(alias.id ?? null, context.collector));
  if (!resolved) return { id: alias.id, name: null, collection: null };
  if (resolved.name) context.variables.add(resolved.name);
  return { id: resolved.id, name: resolved.name, collection: resolved.collection?.name ?? null };
};

const inspectPaint = async (
  paintValue: unknown,
  styleName: string | null,
  context: ProbeContext,
  label: string,
) => {
  const paint = paintValue as Record<string, unknown>;
  const boundVariables = paint.boundVariables && typeof paint.boundVariables === 'object'
    ? paint.boundVariables as Record<string, unknown>
    : {};
  const colorAlias = boundVariables.color;
  const boundVariable = await getAliasData(colorAlias, context, `${label} variable`);
  const result: Record<string, unknown> = {
    type: paint.type ?? null,
    opacity: typeof paint.opacity === 'number' ? paint.opacity : 1,
    hex: null,
    boundVariable,
    styleName,
  };

  if (paint.type === 'SOLID' && paint.color && typeof paint.color === 'object') {
    result.hex = HEX(paint.color as { r: number; g: number; b: number });
    if (!boundVariable) context.stats.hardCodedPaints += 1;
  }

  if (Array.isArray(paint.gradientStops)) {
    result.stops = await Promise.all(paint.gradientStops.map(async (stopValue, index) => {
      const stop = stopValue as Record<string, unknown>;
      const stopBoundVariables = stop.boundVariables && typeof stop.boundVariables === 'object'
        ? stop.boundVariables as Record<string, unknown>
        : {};
      const stopAlias = await getAliasData(stopBoundVariables.color, context, `${label} gradient stop ${index + 1} variable`);
      const color = stop.color as { r?: number; g?: number; b?: number } | undefined;
      if (!stopAlias && color && typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number') {
        context.stats.hardCodedPaints += 1;
      }
      return {
        position: stop.position ?? null,
        hex: color && typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number' ? HEX(color as { r: number; g: number; b: number }) : null,
        boundVariable: stopAlias,
      };
    }));
  }

  if (boundVariable) context.stats.nodesUsingVariables.add(label.replace(/:(?:fill|stroke):\d+$/, ''));
  return result;
};

const inspectNode = async (node: BaseNode, context: ProbeContext, reserved = false) => {
  if (context.visited.has(node.id)) return null;
  if (!reserved && !reserveNode(node, context)) return null;
  context.visited.add(node.id);

  const value = node as unknown as Record<string, unknown>;
  const readsPaints = 'fills' in node || 'strokes' in node;
  const fillsValue = 'fills' in node ? (node as unknown as { fills?: unknown }).fills : null;
  const strokesValue = 'strokes' in node ? (node as unknown as { strokes?: unknown }).strokes : null;
  const fillStyleName = await resolveStyleName(value.fillStyleId, context, `Failed to resolve fill style on ${node.name}`);
  const strokeStyleName = await resolveStyleName(value.strokeStyleId, context, `Failed to resolve stroke style on ${node.name}`);
  const fills = Array.isArray(fillsValue)
    ? await Promise.all(fillsValue.map((paint, index) => inspectPaint(paint, fillStyleName, context, `${node.id}:fill:${index}`)))
    : [];
  const strokes = Array.isArray(strokesValue)
    ? await Promise.all(strokesValue.map((paint, index) => inspectPaint(paint, strokeStyleName, context, `${node.id}:stroke:${index}`)))
    : [];
  if (fillStyleName || strokeStyleName) context.stats.nodesUsingStyles.add(node.id);

  const explicitBoundVariables = (node as unknown as { boundVariables?: Record<string, unknown> }).boundVariables;
  const boundVariables = await serializeBoundVariables(explicitBoundVariables, context.collector);
  if (boundVariables) {
    const collect = (entry: unknown) => {
      if (Array.isArray(entry)) entry.forEach(collect);
      else if (entry && typeof entry === 'object') {
        const binding = entry as { name?: unknown };
        if (typeof binding.name === 'string') context.variables.add(binding.name);
        Object.values(entry).forEach(collect);
      }
    };
    collect(boundVariables);
    if (Object.keys(boundVariables).length > 0) context.stats.nodesUsingVariables.add(node.id);
  }

  const width = 'width' in node && typeof value.width === 'number' ? Number((value.width as number).toFixed(2)) : null;
  const height = 'height' in node && typeof value.height === 'number' ? Number((value.height as number).toFixed(2)) : null;
  const output: Record<string, unknown> = {
    name: node.name,
    type: node.type,
    visible: 'visible' in node ? value.visible : null,
    size: { width, height },
    layoutMode: typeof value.layoutMode === 'string' ? value.layoutMode : null,
    padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].every((key) => typeof value[key] === 'number')
      ? { top: value.paddingTop, right: value.paddingRight, bottom: value.paddingBottom, left: value.paddingLeft }
      : null,
    itemSpacing: typeof value.itemSpacing === 'number' ? value.itemSpacing : null,
    cornerRadius: typeof value.cornerRadius === 'number' ? value.cornerRadius : value.cornerRadius === figma.mixed ? 'MIXED' : null,
    fills,
    strokes,
    boundVariables,
  };

  if ('effects' in node) {
    const effects = (value.effects as unknown[] | undefined) ?? [];
    output.effects = effects.map((effectValue) => {
      const effect = effectValue as Record<string, unknown>;
      return { type: effect.type ?? null, visible: effect.visible ?? true, radius: effect.radius ?? null };
    });
  }

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    const characters = text.characters ?? '';
    let fontName: unknown = text.fontName;
    try {
      const distinctFontNames = characters.length > 0 ? text.getRangeAllFontNames(0, characters.length) : [];
      distinctFontNames.forEach((font) => context.stats.fonts.add(`${font.family} ${font.style}`));
      if (distinctFontNames.length > 1) fontName = distinctFontNames;
      else if (distinctFontNames.length === 1) fontName = distinctFontNames[0];
    } catch (error) {
      context.collector.errors.push(`Failed to read font names for ${node.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const styleId = typeof text.textStyleId === 'string' ? text.textStyleId : null;
    const textStyleName = await resolveStyleName(styleId, context, `Failed to resolve text style on ${node.name}`);
    if (textStyleName) context.stats.nodesUsingStyles.add(node.id);
    output.characters = characters.length > 80 ? `${characters.slice(0, 80)}...` : characters;
    output.fontName = fontName;
    output.fontSize = typeof text.fontSize === 'symbol' ? 'MIXED' : text.fontSize;
    output.lineHeight = typeof text.lineHeight === 'symbol' ? 'MIXED' : text.lineHeight;
    output.letterSpacing = typeof text.letterSpacing === 'symbol' ? 'MIXED' : text.letterSpacing;
    output.textCase = typeof text.textCase === 'symbol' ? 'MIXED' : text.textCase;
    output.textStyleId = styleId;
    output.textStyleName = textStyleName;
  }

  if (!readsPaints && fills.length + strokes.length > 0) {
    context.collector.errors.push(`Unexpected paint properties on ${node.name}.`);
  }
  return output;
};

const isDividerInstance = async (node: BaseNode, context: ProbeContext): Promise<boolean> => {
  if (node.type !== 'INSTANCE') return false;
  if (!reserveNode(node, context)) return false;
  if (node.name.toLowerCase().includes('divider')) return true;
  const mainComponent = await safeRead(context, `Failed to resolve component for ${node.name}`, () => node.getMainComponentAsync());
  return Boolean(mainComponent?.name.toLowerCase().includes('divider'));
};

const appendProbeNode = async (parent: Record<string, unknown>, node: BaseNode, context: ProbeContext, reserved = false) => {
  const serialized = await inspectNode(node, context, reserved);
  if (!serialized) return null;
  const children = parent.children as Array<Record<string, unknown>>;
  children.push(serialized);
  return serialized;
};

const inspectDividerOneLevel = async (instance: InstanceNode, context: ProbeContext, target: Record<string, unknown>) => {
  const instanceOutput = await appendProbeNode(target, instance, context, true);
  if (!instanceOutput) return;
  const children: readonly BaseNode[] = instance.children;
  instanceOutput.children = [];
  for (const child of children) {
    if (context.examined.size >= STYLE_PROBE_MAX_NODES) {
      context.truncated = true;
      break;
    }
    const serialized = await inspectNode(child, context);
    if (serialized) (instanceOutput.children as Array<Record<string, unknown>>).push(serialized);
  }
};

const inspectProbeFrameChildren = async (frame: BaseNode, output: Record<string, unknown>, context: ProbeContext) => {
  if (!('children' in frame) || !Array.isArray(frame.children)) return;
  for (const child of frame.children as BaseNode[]) {
    if (context.examined.size >= STYLE_PROBE_MAX_NODES) {
      context.truncated = true;
      break;
    }
    if (child.type === 'TEXT') {
      await appendProbeNode(output, child, context);
    } else if (await isDividerInstance(child, context)) {
      await inspectDividerOneLevel(child as InstanceNode, context, output);
    }
  }
};

export const probeSelection = async (selectedNode: BaseNode | null) => {
  const collector: ErrorCollector = { errors: [] };
  const context: ProbeContext = {
    collector,
    stats: { nodesUsingStyles: new Set(), hardCodedPaints: 0, nodesUsingVariables: new Set(), fonts: new Set(), styleNames: new Set() },
    variables: new Set(),
    visited: new Set(),
    examined: new Set(),
    truncated: false,
  };
  if (!selectedNode) return { error: 'No node selected.', nodes: [], meta: { errors: ['No node selected.'] } };

  let root = selectedNode;
  const selectedWasInstance = selectedNode.type === 'INSTANCE';
  let mainComponentName: string | null = null;
  if (selectedWasInstance) {
    const mainComponent = await safeRead(context, `Failed to resolve main component for ${selectedNode.name}`, () => (selectedNode as InstanceNode).getMainComponentAsync());
    if (!mainComponent) {
      return { error: 'Could not resolve the selected instance main component.', nodes: [], meta: { selectedWasInstance, mainComponentName, errors: collector.errors } };
    }
    root = mainComponent;
    mainComponentName = mainComponent.name;
  }

  const rootOutput = await inspectNode(root, context);
  if (!rootOutput) {
    return { error: 'Could not inspect the selected root node.', nodes: [], meta: { selectedWasInstance, mainComponentName, errors: collector.errors } };
  }
  rootOutput.children = [];
  await inspectProbeFrameChildren(root, rootOutput, context);

  if ('children' in root && Array.isArray(root.children)) {
    for (const child of root.children as BaseNode[]) {
      if (context.visited.size >= STYLE_PROBE_MAX_NODES) {
        context.truncated = true;
        break;
      }
      if (child.type !== 'FRAME') continue;
      const childOutput = await appendProbeNode(rootOutput, child, context);
      if (!childOutput) continue;
      childOutput.children = [];
      await inspectProbeFrameChildren(child, childOutput, context);
    }
  }

  return {
    selectedNodeId: selectedNode.id,
    selectedNodeType: selectedNode.type,
    name: root.name,
    nodes: [rootOutput],
    meta: {
      selectedWasInstance,
      mainComponentName,
      visitedNodeCount: context.examined.size,
      truncated: context.truncated,
      nodesUsingStyles: context.stats.nodesUsingStyles.size,
      hardCodedPaints: context.stats.hardCodedPaints,
      nodesUsingVariables: context.stats.nodesUsingVariables.size,
      distinctFontNames: Array.from(context.stats.fonts).sort(),
      distinctStyleNames: Array.from(context.stats.styleNames).sort(),
      distinctVariableNames: Array.from(context.variables).sort(),
      errors: collector.errors,
    },
  };
};

interface TokenValueResult {
  value: string | number | null;
  aliasTarget: string | null;
}

const resolveTokenValue = async (
  variable: Variable,
  modeName: string,
  visited = new Set<string>(),
): Promise<TokenValueResult> => {
  if (visited.has(variable.id)) return { value: null, aliasTarget: variable.name };
  visited.add(variable.id);
  const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
  if (!collection) throw new Error(`Collection not found for ${variable.name}.`);
  const mode = collection.modes.find((entry) => entry.name === modeName);
  if (!mode) throw new Error(`Mode "${modeName}" was not found in collection ${collection.name}.`);
  const raw = variable.valuesByMode[mode.modeId];
  if (raw === undefined) throw new Error(`No value for ${variable.name} in mode ${mode.name}.`);

  if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'VARIABLE_ALIAS') {
    const targetId = (raw as { id?: string }).id;
    if (!targetId) throw new Error(`Alias on ${variable.name} has no target id.`);
    const target = await figma.variables.getVariableByIdAsync(targetId);
    if (!target) throw new Error(`Alias target ${targetId} for ${variable.name} was not found.`);
    const resolved = await resolveTokenValue(target, modeName, visited);
    return { ...resolved, aliasTarget: target.name };
  }

  if (variable.resolvedType === 'COLOR') {
    const color = raw as RGBA;
    return { value: HEX(color), aliasTarget: null };
  }
  return { value: typeof raw === 'number' ? raw : null, aliasTarget: null };
};

const readTokenMode = async (variable: Variable, modeName: string, errors: string[]) => {
  try {
    return await resolveTokenValue(variable, modeName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to resolve ${variable.name} (${modeName}): ${message}`);
    return { value: null, aliasTarget: null, error: message };
  }
};

export const readTokenCatalogue = async () => {
  const errors: string[] = [];
  const notes: string[] = [];
  const output: Array<{ name: string; source: 'local' | 'library'; libraryName?: string; count: number; variables: Array<Record<string, unknown>> }> = [];

  let localCollections: VariableCollection[] = [];
  try {
    localCollections = await figma.variables.getLocalVariableCollectionsAsync();
  } catch (error) {
    errors.push(`Failed to list local variable collections: ${error instanceof Error ? error.message : String(error)}`);
  }

  let localVariables: Variable[] = [];
  try {
    localVariables = await figma.variables.getLocalVariablesAsync();
  } catch (error) {
    errors.push(`Failed to list local variables: ${error instanceof Error ? error.message : String(error)}`);
  }

  let libraryCollections: LibraryVariableCollection[] = [];
  try {
    if (figma.teamLibrary) libraryCollections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    else errors.push('Team library access is unavailable in this file.');
  } catch (error) {
    errors.push(`Failed to list library collections: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const collectionName of TOKEN_COLLECTIONS) {
    let found = false;
    const localCollection = localCollections.find((collection) => collection.name === collectionName);
    if (localCollection) {
      found = true;
      const variables = localVariables.filter((variable) => variable.variableCollectionId === localCollection.id && (variable.resolvedType === 'COLOR' || variable.resolvedType === 'FLOAT'));
      const rows: Array<Record<string, unknown>> = [];
      for (const variable of variables) {
        const tesco = await readTokenMode(variable, 'Tesco', errors);
        const dark = await readTokenMode(variable, 'Tesco dark mode', errors);
        rows.push({ name: variable.name, type: variable.resolvedType, key: variable.key, values: { Tesco: tesco.value, 'Tesco dark mode': dark.value }, aliasTargets: { Tesco: tesco.aliasTarget, 'Tesco dark mode': dark.aliasTarget }, modeErrors: { Tesco: 'error' in tesco ? tesco.error : null, 'Tesco dark mode': 'error' in dark ? dark.error : null } });
      }
      output.push({ name: localCollection.name, source: 'local', count: rows.length, variables: rows });
    }

    const matchingLibraryCollections = libraryCollections.filter((collection) => collection.name === collectionName);
    for (const libraryCollection of matchingLibraryCollections) {
      found = true;
      const rows: Array<Record<string, unknown>> = [];
      try {
        const libraryVariables = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libraryCollection.key);
        for (const libraryVariable of libraryVariables.filter((entry) => entry.resolvedType === 'COLOR' || entry.resolvedType === 'FLOAT')) {
          try {
            const imported = await figma.variables.importVariableByKeyAsync(libraryVariable.key);
            const tesco = await readTokenMode(imported, 'Tesco', errors);
            const dark = await readTokenMode(imported, 'Tesco dark mode', errors);
            rows.push({ name: libraryVariable.name, type: libraryVariable.resolvedType, key: libraryVariable.key, values: { Tesco: tesco.value, 'Tesco dark mode': dark.value }, aliasTargets: { Tesco: tesco.aliasTarget, 'Tesco dark mode': dark.aliasTarget }, modeErrors: { Tesco: 'error' in tesco ? tesco.error : null, 'Tesco dark mode': 'error' in dark ? dark.error : null } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`Failed to read library token ${libraryVariable.name}: ${message}`);
            rows.push({ name: libraryVariable.name, type: libraryVariable.resolvedType, key: libraryVariable.key, values: { Tesco: null, 'Tesco dark mode': null }, aliasTargets: { Tesco: null, 'Tesco dark mode': null }, error: message });
          }
        }
      } catch (error) {
        errors.push(`Failed to list variables in library collection ${libraryCollection.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      output.push({ name: libraryCollection.name, source: 'library', libraryName: libraryCollection.libraryName, count: rows.length, variables: rows });
    }

    if (!found) notes.push(`Collection "${collectionName}" was not found in this file or enabled libraries.`);
  }

  return {
    tokenCollections: TOKEN_COLLECTIONS,
    collections: output,
    note: 'Reading library values imports those variables into this file.',
    meta: { errors, notes },
  };
};
