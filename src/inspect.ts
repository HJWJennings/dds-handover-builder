type ComponentDefSummary = {
  propertyName: string;
  type: string | null;
  defaultValue: unknown;
  variantOptions: unknown[];
};

type LayerTreeNode = {
  name: string;
  type: string;
  absoluteBoundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  mainComponentName?: string | null;
  isRemote?: boolean;
  boundVariables?: Record<string, unknown>;
  characters?: string;
  children?: LayerTreeNode[];
};

type VariableResolution = {
  id: string;
  name: string | null;
  resolvedType: VariableResolvedDataType | null;
  remote: boolean;
  collectionId: string | null;
  collection?: {
    name: string | null;
    modes: string[];
  };
};

type LibraryVariableCollection = {
  name: string;
  libraryName: string;
  key: string;
};

export type ErrorCollector = {
  errors: string[];
};

type FrameInspectionNode = {
  name: string;
  type: string;
  width: number | null;
  height: number | null;
  layoutMode: string | null;
  padding: { top: number; right: number; bottom: number; left: number } | null;
  itemSpacing: number | null;
  cornerRadius: number | string | null;
  clipsContent: boolean | null;
  fills: unknown[];
  strokes: unknown[];
  effects: unknown[];
  boundVariables: Record<string, unknown> | null;
  explicitVariableModes: Record<string, unknown> | null;
  characters?: string;
  fontName?: unknown;
  fontSize?: unknown;
  lineHeight?: unknown;
  letterSpacing?: unknown;
  textCase?: unknown;
  textStyleName?: string | null;
  children?: FrameInspectionNode[];
};

type FrameInspectionSummary = {
  fonts: string[];
  variables: string[];
  nodesWithBoundVariables: number;
  hardCodedColorCount: number;
  textStyles: string[];
  explicitVariableModes: Record<string, unknown> | null;
};

type FrameInspection = FrameInspectionNode & {
  truncated: boolean;
  summary: FrameInspectionSummary;
};

export type InspectionResult = {
  selectedNodeId: string | null;
  nodeType: string | null;
  name: string | null;
  source: 'component-set' | 'component' | 'instance' | 'frame' | 'unsupported';
  componentPropertyDefinitions: ComponentDefSummary[];
  variants: Array<{
    name: string;
    variantProperties: Record<string, unknown>;
    reactions: Array<{
      trigger: unknown;
      action: unknown;
      actions?: unknown[];
      transition: unknown;
      duration?: number | null;
      easing?: string | null;
      destinationNodeName?: string | null;
    }>;
    layerTree: LayerTreeNode[];
  }>;
  setBoundVariables: Record<string, unknown> | null;
  setExplicitVariableModes: Record<string, unknown> | null;
  variantBoundVariables: Array<{ name: string; boundVariables: Record<string, unknown> | null; explicitVariableModes: Record<string, unknown> | null }>;
  fileVariableCollections: Array<{
    id: string;
    name: string;
    modes: string[];
  }>;
  libraryVariableCollections: LibraryVariableCollection[];
  fileVariableModes: Array<{
    collection: string;
    modes: string[];
  }>;
  frameInspection?: FrameInspection;
  meta: {
    selectionType: string;
    variantCount: number;
    nodesWithBoundVariables: number;
    resolvedFromInstance: boolean;
    resolvedFromInstanceDetail?: {
      instanceId: string;
      instanceName: string;
      mainComponentName: string | null;
    };
    errors: string[];
  };
  error?: string;
};

const variableResolutionCache = new Map<string, Promise<VariableResolution | null>>();
const variableCollectionCache = new Map<string, Promise<{ id: string; name: string | null; modes: string[] } | null>>();

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return error.stack ? `${error.message}\n${error.stack}` : error.message;
  }

  return String(error);
};

const pushError = (collector: ErrorCollector, context: string, error: unknown) => {
  collector.errors.push(`${context}: ${formatError(error)}`);
};

const roundRect = (rect: Rect | null) => {
  if (!rect) return null;

  return {
    x: Number(rect.x.toFixed(2)),
    y: Number(rect.y.toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
  };
};

const getRelativeBoundingBox = (node: BaseNode, root: BaseNode) => {
  const nodeBounds = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null;
  const rootBounds = 'absoluteBoundingBox' in root ? root.absoluteBoundingBox : null;

  if (!nodeBounds || !rootBounds) {
    return null;
  }

  return {
    x: Number((nodeBounds.x - rootBounds.x).toFixed(2)),
    y: Number((nodeBounds.y - rootBounds.y).toFixed(2)),
    width: Number(nodeBounds.width.toFixed(2)),
    height: Number(nodeBounds.height.toFixed(2)),
  };
};

const resolveVariableCollection = async (collectionId: string | null, collector: ErrorCollector) => {
  if (!collectionId) {
    return null;
  }

  const cached = variableCollectionCache.get(collectionId);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    try {
      const collection = collectionId ? await figma.variables.getVariableCollectionByIdAsync(collectionId) : null;
      if (!collection) {
        return null;
      }

      return {
        id: collection.id,
        name: collection.name,
        modes: collection.modes.map((mode) => mode.name),
      };
    } catch (error) {
      pushError(collector, `Failed to resolve variable collection ${collectionId}`, error);
      return null;
    }
  })();

  variableCollectionCache.set(collectionId, promise);
  return promise;
};

export const resolveVariableMetadata = async (variableId: string | null, collector: ErrorCollector) => {
  if (!variableId) {
    return null;
  }

  const cached = variableResolutionCache.get(variableId);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    try {
      const variable = await figma.variables.getVariableByIdAsync(variableId);
      if (!variable) {
        return null;
      }

      const collection = await resolveVariableCollection(variable.variableCollectionId ?? null, collector);

      return {
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType ?? null,
        remote: Boolean(variable.remote),
        collectionId: variable.variableCollectionId ?? null,
        collection: collection ? { name: collection.name, modes: collection.modes } : undefined,
      };
    } catch (error) {
      pushError(collector, `Failed to resolve variable ${variableId}`, error);
      return null;
    }
  })();

  variableResolutionCache.set(variableId, promise);
  return promise;
};

export const serializeBoundVariables = async (boundVariables: Record<string, unknown> | undefined, collector: ErrorCollector) => {
  if (!boundVariables) {
    return null;
  }

  const output: Record<string, unknown> = {};

  const resolveAlias = async (aliasValue: unknown) => {
    const alias = aliasValue as { id?: string; type?: string } | undefined;
    const variableId = alias?.id ?? null;
    const resolved = variableId ? await resolveVariableMetadata(variableId, collector) : null;

    return {
      id: variableId,
      name: resolved?.name ?? null,
      resolvedType: resolved?.resolvedType ?? alias?.type ?? null,
      remote: resolved?.remote ?? false,
      collectionId: resolved?.collectionId ?? null,
      collection: resolved?.collection ?? null,
    };
  };

  for (const [key, value] of Object.entries(boundVariables)) {
    if (Array.isArray(value)) {
      output[key] = await Promise.all(value.map((entry) => resolveAlias(entry)));
      continue;
    }

    output[key] = await resolveAlias(value);
  }

  return output;
};

const getPaintLevelBindings = async (node: BaseNode, collector: ErrorCollector) => {
  const output: Record<string, unknown> = {};

  const resolvePaintArray = async (paints: unknown, key: 'fills' | 'strokes') => {
    if (!Array.isArray(paints)) {
      return;
    }

    const resolved = await Promise.all(paints.map(async (paint, index) => {
      const colorAlias = (paint as { boundVariables?: { color?: unknown } })?.boundVariables?.color;
      if (!colorAlias) {
        return null;
      }

      const serialized = await serializeBoundVariables({ color: colorAlias }, collector);
      return {
        index,
        color: serialized?.color ?? null,
      };
    }));

    const filtered = resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (filtered.length > 0) {
      output[`${key}PaintBindings`] = filtered;
    }
  };

  if ('fills' in node) {
    await resolvePaintArray((node as unknown as { fills?: unknown }).fills, 'fills');
  }

  if ('strokes' in node) {
    await resolvePaintArray((node as unknown as { strokes?: unknown }).strokes, 'strokes');
  }

  return output;
};

const serializeExplicitVariableModes = (modes: Record<string, unknown> | undefined) => {
  if (!modes) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(modes).map(([key, value]) => [key, value]),
  );
};

const collectLayerTree = async (node: BaseNode, root: BaseNode, collector: ErrorCollector): Promise<LayerTreeNode[]> => {
  const self: LayerTreeNode = {
    name: node.name,
    type: node.type,
    absoluteBoundingBox: getRelativeBoundingBox(node, root),
  };

  if (node.type === 'INSTANCE') {
    try {
      const mainComponent = await node.getMainComponentAsync();
      self.mainComponentName = mainComponent?.name ?? null;
    } catch (error) {
      pushError(collector, `Failed to resolve main component for instance ${node.name}`, error);
      self.mainComponentName = null;
    }
    self.isRemote = Boolean((node as unknown as { remote?: boolean }).remote);
  }

  const nodeBoundVariables = await serializeBoundVariables(
    (node as unknown as { boundVariables?: Record<string, unknown> }).boundVariables,
    collector,
  );
  const paintBindings = await getPaintLevelBindings(node, collector);
  const mergedBindings = {
    ...(nodeBoundVariables ?? {}),
    ...paintBindings,
  };

  if (Object.keys(mergedBindings).length > 0) {
    self.boundVariables = mergedBindings;
  }

  if (node.type === 'TEXT') {
    const raw = node.characters ?? '';
    self.characters = raw.length > 80 ? `${raw.slice(0, 80)}...` : raw;
  }

  if ('children' in node && Array.isArray(node.children)) {
    const children = await Promise.all(node.children.map((child) => collectLayerTree(child, root, collector)));
    self.children = children.flat();
  }

  return [self];
};

export const getComponentPropertyDefinitions = (node: BaseNode, collector?: ErrorCollector) => {
  if (!('componentPropertyDefinitions' in node)) {
    return [] as ComponentDefSummary[];
  }

  try {
    const definitions = (node as unknown as { componentPropertyDefinitions?: Record<string, unknown> }).componentPropertyDefinitions;
    if (!definitions) {
      return [] as ComponentDefSummary[];
    }

    return Object.entries(definitions).map(([propertyName, value]) => {
      const definition = value as {
        type?: string;
        defaultValue?: unknown;
        variantOptions?: unknown[];
      };

      return {
        propertyName,
        type: definition.type ?? null,
        defaultValue: definition.defaultValue ?? null,
        variantOptions: Array.isArray(definition.variantOptions) ? definition.variantOptions : [],
      };
    });
  } catch (error) {
    if (collector) {
      pushError(collector, `Failed to read componentPropertyDefinitions for ${node.name}`, error);
    }
    return [] as ComponentDefSummary[];
  }
};

const getVariants = async (node: ComponentSetNode | ComponentNode, collector: ErrorCollector) => {
  const variants = node.type === 'COMPONENT_SET' ? node.children : [node];

  return Promise.all(variants.map(async (variant) => {
    const reactions = Array.isArray((variant as unknown as { reactions?: Array<Record<string, unknown>> }).reactions)
      ? (variant as unknown as { reactions?: Array<Record<string, unknown>> }).reactions ?? []
      : [];
    const variantProperties = 'variantProperties' in variant ? (variant.variantProperties ?? {}) : {};

    return {
      name: variant.name,
      variantProperties,
      reactions: reactions.map((reaction) => {
        const actionValue = (reaction as any).action ?? null;
        const actionsValue = Array.isArray((reaction as any).actions) ? (reaction as any).actions : actionValue ? [actionValue] : [];

        const transition = (reaction as any).transition ?? null;
        const transitionObject = transition && typeof transition === 'object' ? transition as Record<string, unknown> : null;
        const destinationNodeName =
          typeof (reaction as any).destinationNode === 'object' && (reaction as any).destinationNode && 'name' in (reaction as any).destinationNode
            ? (reaction as any).destinationNode.name
            : null;

        return {
          trigger: (reaction as any).trigger ?? null,
          action: actionValue,
          actions: actionsValue,
          transition: transitionObject,
          duration: transitionObject && 'duration' in transitionObject ? (transitionObject.duration as number | null) ?? null : null,
          easing: transitionObject && 'easing' in transitionObject ? (transitionObject.easing as string | null) ?? null : null,
          destinationNodeName,
        };
      }),
      layerTree: await collectLayerTree(variant, variant, collector),
    };
  }));
};

const getVariableCollections = async (collector: ErrorCollector) => {
  if (!('variables' in figma)) {
    return [];
  }

  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();

    return collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      modes: collection.modes.map((mode) => mode.name),
    }));
  } catch (error) {
    pushError(collector, 'Failed to load local variable collections', error);
    return [];
  }
};

const getLibraryVariableCollections = async (collector: ErrorCollector) => {
  if (!('teamLibrary' in figma) || !figma.teamLibrary) {
    return [] as LibraryVariableCollection[];
  }

  try {
    const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    return collections.map((collection) => ({
      name: collection.name,
      libraryName: collection.libraryName,
      key: collection.key,
    }));
  } catch (error) {
    pushError(collector, 'Failed to load library variable collections', error);
    return [] as LibraryVariableCollection[];
  }
};

const getFileVariableModes = (collections: Array<{ name: string; modes: string[] }>) => {
  return collections.map((collection) => ({
    collection: collection.name,
    modes: Array.from(new Set(collection.modes)),
  }));
};

const MAX_FRAME_INSPECTION_DEPTH = 4;
const MAX_FRAME_INSPECTION_NODES = 200;

type FrameWalkContext = {
  collector: ErrorCollector;
  visited: number;
  truncated: boolean;
  nodesWithBoundVariables: number;
  fonts: Set<string>;
  variables: Set<string>;
  textStyles: Set<string>;
  hardCodedColorCount: number;
};

const serializeMixedValue = (value: unknown): unknown => typeof value === 'symbol' ? 'MIXED' : value;

const toHexColor = (color: { r: number; g: number; b: number }): string =>
  `#${[color.r, color.g, color.b].map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const collectVariableNames = (value: unknown, variables: Set<string>) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectVariableNames(entry, variables));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.name === 'string' && 'id' in record && 'resolvedType' in record) {
    variables.add(record.name);
  }
  Object.values(record).forEach((entry) => collectVariableNames(entry, variables));
};

const serializeColor = async (
  color: unknown,
  alias: unknown,
  opacity: number,
  context: FrameWalkContext,
): Promise<Record<string, unknown>> => {
  const result: Record<string, unknown> = { opacity };
  const bound = Boolean(alias && typeof alias === 'object' && 'id' in alias);
  if (bound) {
    const resolved = await serializeBoundVariables({ color: alias }, context.collector);
    const binding = resolved?.color as Record<string, unknown> | undefined;
    if (binding) {
      result.variable = binding;
      collectVariableNames(binding, context.variables);
    }
    result.boundToVariable = true;
  } else if (color && typeof color === 'object' && 'r' in color && 'g' in color && 'b' in color) {
    result.hex = toHexColor(color as { r: number; g: number; b: number });
    result.boundToVariable = false;
    context.hardCodedColorCount += 1;
  }
  return result;
};

const serializePaint = async (paint: unknown, context: FrameWalkContext): Promise<Record<string, unknown>> => {
  const record = paint as Record<string, unknown>;
  const boundVariables = record.boundVariables && typeof record.boundVariables === 'object'
    ? record.boundVariables as Record<string, unknown>
    : {};
  const result: Record<string, unknown> = {
    type: record.type ?? null,
    visible: record.visible ?? true,
    opacity: typeof record.opacity === 'number' ? record.opacity : 1,
    blendMode: record.blendMode ?? null,
  };

  if (record.type === 'SOLID') {
    Object.assign(result, await serializeColor(record.color, boundVariables.color, result.opacity as number, context));
  } else if (Array.isArray(record.gradientStops)) {
    result.gradientStops = await Promise.all(record.gradientStops.map(async (stopValue) => {
      const stop = stopValue as Record<string, unknown>;
      const stopBindings = stop.boundVariables && typeof stop.boundVariables === 'object'
        ? stop.boundVariables as Record<string, unknown>
        : {};
      return {
        position: stop.position ?? null,
        ...await serializeColor(stop.color, stopBindings.color, result.opacity as number, context),
      };
    }));
  }

  return result;
};

const serializePaintArray = async (value: unknown, context: FrameWalkContext): Promise<unknown[]> => {
  if (!Array.isArray(value)) return [];
  return Promise.all(value.map((paint) => serializePaint(paint, context)));
};

const serializeEffect = async (effect: unknown, context: FrameWalkContext): Promise<Record<string, unknown>> => {
  const record = effect as Record<string, unknown>;
  const result: Record<string, unknown> = {
    type: record.type ?? null,
    visible: record.visible ?? true,
    radius: record.radius ?? null,
    spread: record.spread ?? null,
    offset: record.offset ?? null,
    blendMode: record.blendMode ?? null,
  };
  if ('color' in record) {
    const color = record.color as { a?: number } | null;
    const boundVariables = record.boundVariables && typeof record.boundVariables === 'object'
      ? record.boundVariables as Record<string, unknown>
      : {};
    Object.assign(result, await serializeColor(record.color, boundVariables.color, color?.a ?? 1, context));
  }
  return result;
};

const serializeEffects = async (value: unknown, context: FrameWalkContext): Promise<unknown[]> => {
  if (!Array.isArray(value)) return [];
  return Promise.all(value.map((effect) => serializeEffect(effect, context)));
};

const serializeFrameExplicitModes = async (node: BaseNode, collector: ErrorCollector): Promise<Record<string, unknown> | null> => {
  const raw = (node as unknown as { explicitVariableModes?: Record<string, unknown> }).explicitVariableModes;
  if (!raw) return null;
  const output: Record<string, unknown> = {};

  for (const [collectionId, modeValue] of Object.entries(raw)) {
    const modeId = typeof modeValue === 'string' ? modeValue : null;
    try {
      const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
      const mode = modeId ? collection?.modes.find((entry) => entry.modeId === modeId) : null;
      output[collection?.name ?? collectionId] = {
        collectionId,
        modeId,
        modeName: mode?.name ?? null,
      };
    } catch (error) {
      pushError(collector, `Failed to resolve explicit variable mode for ${collectionId}`, error);
      output[collectionId] = { collectionId, modeId, modeName: null };
    }
  }

  return output;
};

const serializeFrameNode = async (
  node: BaseNode,
  context: FrameWalkContext,
  depth: number,
): Promise<FrameInspectionNode | null> => {
  if (context.visited >= MAX_FRAME_INSPECTION_NODES) {
    context.truncated = true;
    return null;
  }
  context.visited += 1;

  const dimensions = node as unknown as { width?: unknown; height?: unknown };
  const frame = node as unknown as {
    layoutMode?: unknown;
    paddingTop?: unknown;
    paddingRight?: unknown;
    paddingBottom?: unknown;
    paddingLeft?: unknown;
    itemSpacing?: unknown;
    cornerRadius?: unknown;
    clipsContent?: unknown;
    fills?: unknown;
    strokes?: unknown;
    effects?: unknown;
    children?: BaseNode[];
    boundVariables?: Record<string, unknown>;
    explicitVariableModes?: Record<string, unknown>;
  };

  const boundVariables = await serializeBoundVariables(frame.boundVariables, context.collector);
  if (boundVariables && Object.keys(boundVariables).length > 0) context.nodesWithBoundVariables += 1;
  collectVariableNames(boundVariables, context.variables);
  const explicitVariableModes = await serializeFrameExplicitModes(node, context.collector);
  const fills = await serializePaintArray(frame.fills, context);
  const strokes = await serializePaintArray(frame.strokes, context);
  const effects = await serializeEffects(frame.effects, context);
  const self: FrameInspectionNode = {
    name: node.name,
    type: node.type,
    width: typeof dimensions.width === 'number' ? Number(dimensions.width.toFixed(2)) : null,
    height: typeof dimensions.height === 'number' ? Number(dimensions.height.toFixed(2)) : null,
    layoutMode: typeof frame.layoutMode === 'string' ? frame.layoutMode : null,
    padding: typeof frame.paddingTop === 'number' && typeof frame.paddingRight === 'number' &&
      typeof frame.paddingBottom === 'number' && typeof frame.paddingLeft === 'number'
      ? { top: frame.paddingTop, right: frame.paddingRight, bottom: frame.paddingBottom, left: frame.paddingLeft }
      : null,
    itemSpacing: typeof frame.itemSpacing === 'number' ? frame.itemSpacing : null,
    cornerRadius: typeof frame.cornerRadius === 'number' ? frame.cornerRadius : frame.cornerRadius === figma.mixed ? 'MIXED' : null,
    clipsContent: typeof frame.clipsContent === 'boolean' ? frame.clipsContent : null,
    fills,
    strokes,
    effects,
    boundVariables,
    explicitVariableModes,
  };

  if (node.type === 'TEXT') {
    try {
      const text = node as TextNode;
      const characters = text.characters ?? '';
      const fontName = serializeMixedValue(text.fontName);
      const allFontNames = characters.length > 0 ? text.getRangeAllFontNames(0, characters.length) : [];
      allFontNames.forEach((font) => context.fonts.add(`${font.family} ${font.style}`));
      if (fontName && typeof fontName === 'object' && 'family' in fontName && 'style' in fontName) {
        const font = fontName as FontName;
        context.fonts.add(`${font.family} ${font.style}`);
      }
      let textStyleName: string | null = null;
      const styleId = text.textStyleId;
      if (typeof styleId === 'string' && styleId.length > 0) {
        const style = await figma.getStyleByIdAsync(styleId);
        if (style?.type === 'TEXT') {
          textStyleName = style.name;
          context.textStyles.add(style.name);
        }
      }
      self.characters = characters.length > 80 ? `${characters.slice(0, 80)}...` : characters;
      self.fontName = fontName;
      self.fontSize = serializeMixedValue(text.fontSize);
      self.lineHeight = serializeMixedValue(text.lineHeight);
      self.letterSpacing = serializeMixedValue(text.letterSpacing);
      self.textCase = serializeMixedValue(text.textCase);
      self.textStyleName = textStyleName;
    } catch (error) {
      pushError(context.collector, `Failed to inspect text node ${node.name}`, error);
      self.characters = node.characters.length > 80 ? `${node.characters.slice(0, 80)}...` : node.characters;
    }
  }

  const children = frame.children;
  if (Array.isArray(children) && children.length > 0) {
    if (depth >= MAX_FRAME_INSPECTION_DEPTH) {
      context.truncated = true;
    } else {
      const nested: FrameInspectionNode[] = [];
      for (const child of children) {
        if (context.visited >= MAX_FRAME_INSPECTION_NODES) {
          context.truncated = true;
          break;
        }
        const serialized = await serializeFrameNode(child, context, depth + 1);
        if (serialized) nested.push(serialized);
      }
      self.children = nested;
    }
  }

  return self;
};

const inspectFrameSelection = async (node: FrameNode | SectionNode, collector: ErrorCollector): Promise<FrameInspection> => {
  const context: FrameWalkContext = {
    collector,
    visited: 0,
    truncated: false,
    nodesWithBoundVariables: 0,
    fonts: new Set(),
    variables: new Set(),
    textStyles: new Set(),
    hardCodedColorCount: 0,
  };
  const serialized = await serializeFrameNode(node, context, 0);
  if (!serialized) throw new Error(`Failed to serialize selected ${node.type.toLowerCase()}.`);
  return {
    ...serialized,
    truncated: context.truncated,
    summary: {
      fonts: Array.from(context.fonts).sort(),
      variables: Array.from(context.variables).sort(),
      nodesWithBoundVariables: context.nodesWithBoundVariables,
      hardCodedColorCount: context.hardCodedColorCount,
      textStyles: Array.from(context.textStyles).sort(),
      explicitVariableModes: serialized.explicitVariableModes,
    },
  };
};

export async function inspectSelectionNode(node: BaseNode | null): Promise<InspectionResult> {
  const collector: ErrorCollector = { errors: [] };

  if (!node) {
    return {
      selectedNodeId: null,
      nodeType: null,
      name: null,
      source: 'unsupported',
      componentPropertyDefinitions: [],
      variants: [],
      setBoundVariables: null,
      setExplicitVariableModes: null,
      variantBoundVariables: [],
      fileVariableCollections: [],
      libraryVariableCollections: [],
      fileVariableModes: [],
      meta: {
        selectionType: 'none',
        variantCount: 0,
        nodesWithBoundVariables: 0,
        resolvedFromInstance: false,
        errors: ['No node selected.'],
      },
      error: 'No node selected.',
    };
  }

  try {
    if (node.type === 'FRAME' || node.type === 'SECTION') {
      const frameInspection = await inspectFrameSelection(node, collector);
      const localVariableCollections = await getVariableCollections(collector);
      const libraryVariableCollections = await getLibraryVariableCollections(collector);
      return {
        selectedNodeId: node.id,
        nodeType: node.type,
        name: node.name,
        source: 'frame',
        componentPropertyDefinitions: [],
        variants: [],
        setBoundVariables: frameInspection.boundVariables,
        setExplicitVariableModes: frameInspection.explicitVariableModes,
        variantBoundVariables: [],
        fileVariableCollections: localVariableCollections,
        libraryVariableCollections,
        fileVariableModes: getFileVariableModes(localVariableCollections),
        frameInspection,
        meta: {
          selectionType: node.type,
          variantCount: 0,
          nodesWithBoundVariables: frameInspection.summary.nodesWithBoundVariables,
          resolvedFromInstance: false,
          errors: collector.errors,
        },
      };
    }

    let selectedNode: BaseNode = node;
    let resolvedFromInstance = false;
    let resolvedFromInstanceDetail: InspectionResult['meta']['resolvedFromInstanceDetail'] | undefined;

    if (node.type === 'INSTANCE') {
      const mainComponent = await node.getMainComponentAsync();

      if (!mainComponent) {
        const reason = `Selected ${node.type}:${node.name} is not inspectable because its main component could not be resolved.`;
        const localVariableCollections = await getVariableCollections(collector);
        const libraryVariableCollections = await getLibraryVariableCollections(collector);

        return {
          selectedNodeId: node.id,
          nodeType: node.type,
          name: node.name,
          source: 'instance',
          componentPropertyDefinitions: [],
          variants: [],
          setBoundVariables: null,
          setExplicitVariableModes: null,
          variantBoundVariables: [],
          fileVariableCollections: localVariableCollections,
          libraryVariableCollections,
          fileVariableModes: getFileVariableModes(localVariableCollections),
          meta: {
            selectionType: node.type,
            variantCount: 0,
            nodesWithBoundVariables: 0,
            resolvedFromInstance: true,
            resolvedFromInstanceDetail: {
              instanceId: node.id,
              instanceName: node.name,
              mainComponentName: null,
            },
            errors: [reason, ...collector.errors],
          },
          error: reason,
        };
      }

      selectedNode = mainComponent;
      resolvedFromInstance = true;
      resolvedFromInstanceDetail = {
        instanceId: node.id,
        instanceName: node.name,
        mainComponentName: mainComponent.name,
      };
    }

    const inspectableNode =
      selectedNode.type === 'COMPONENT' && selectedNode.parent?.type === 'COMPONENT_SET'
        ? selectedNode.parent
        : selectedNode;

    if (inspectableNode.type !== 'COMPONENT' && inspectableNode.type !== 'COMPONENT_SET') {
      const localVariableCollections = await getVariableCollections(collector);
      const libraryVariableCollections = await getLibraryVariableCollections(collector);
      const selectedType = node.type;
      const selectedName = 'name' in node ? node.name : 'unnamed';
      const reason = `Selected ${selectedType}:${selectedName} is not inspectable. Select a COMPONENT_SET, COMPONENT, or a COMPONENT variant inside a COMPONENT_SET.`;

      return {
        selectedNodeId: node.id,
        nodeType: node.type,
        name: node.name,
        source: 'unsupported',
        componentPropertyDefinitions: [],
        variants: [],
        setBoundVariables: null,
        setExplicitVariableModes: null,
        variantBoundVariables: [],
        fileVariableCollections: localVariableCollections,
        libraryVariableCollections,
        fileVariableModes: getFileVariableModes(localVariableCollections),
        meta: {
          selectionType: node.type,
          variantCount: 0,
          nodesWithBoundVariables: 0,
          resolvedFromInstance,
          resolvedFromInstanceDetail,
          errors: [reason, ...collector.errors],
        },
        error: reason,
      };
    }

    const setNode = inspectableNode as ComponentSetNode | ComponentNode;
    const variantList = await getVariants(setNode, collector);

    const setBoundVariables = await serializeBoundVariables(
      (setNode as unknown as { boundVariables?: Record<string, unknown> }).boundVariables,
      collector,
    );
    const setExplicitVariableModes = serializeExplicitVariableModes(
      (setNode as unknown as { explicitVariableModes?: Record<string, unknown> }).explicitVariableModes,
    );

    const variantBoundVariables = await Promise.all(variantList.map(async (variant) => {
      const target = setNode.type === 'COMPONENT_SET'
        ? setNode.children.find((child) => child.name === variant.name) ?? setNode
        : setNode;

      return {
        name: variant.name,
        boundVariables: await serializeBoundVariables((target as unknown as { boundVariables?: Record<string, unknown> }).boundVariables, collector),
        explicitVariableModes: serializeExplicitVariableModes((target as unknown as { explicitVariableModes?: Record<string, unknown> }).explicitVariableModes),
      };
    }));

    const localVariableCollections = await getVariableCollections(collector);
    const libraryVariableCollections = await getLibraryVariableCollections(collector);
    const candidateNodes = [setNode, ...variantList.map((variant) => setNode.type === 'COMPONENT_SET'
      ? setNode.children.find((child) => child.name === variant.name)
      : setNode)] as Array<SceneNode | null | undefined>;

    const nodesWithBoundVariables = candidateNodes.filter((candidate): candidate is SceneNode => candidate != null && 'type' in candidate).filter((candidate) => {
      const candidateData = candidate as unknown as { boundVariables?: Record<string, unknown> };
      return Boolean(candidateData.boundVariables && Object.keys(candidateData.boundVariables).length > 0);
    }).length;

    return {
      selectedNodeId: node.id,
      nodeType: node.type,
      name: node.name,
      source: node.type === 'COMPONENT_SET' ? 'component-set' : node.type === 'COMPONENT' ? 'component' : 'instance',
      componentPropertyDefinitions: getComponentPropertyDefinitions(setNode, collector),
      variants: variantList,
      setBoundVariables,
      setExplicitVariableModes,
      variantBoundVariables,
      fileVariableCollections: localVariableCollections,
      libraryVariableCollections,
      fileVariableModes: getFileVariableModes(localVariableCollections),
      meta: {
        selectionType: node.type,
        variantCount: variantList.length,
        nodesWithBoundVariables,
        resolvedFromInstance,
        resolvedFromInstanceDetail,
        errors: collector.errors,
      },
    };
  } catch (error) {
    const message = formatError(error);
    collector.errors.push(message);
    const localVariableCollections = await getVariableCollections(collector);
    const libraryVariableCollections = await getLibraryVariableCollections(collector);

    return {
      selectedNodeId: node.id,
      nodeType: node.type,
      name: node.name,
      source: node.type === 'COMPONENT_SET' ? 'component-set' : node.type === 'COMPONENT' ? 'component' : node.type === 'FRAME' || node.type === 'SECTION' ? 'frame' : 'instance',
      componentPropertyDefinitions: [],
      variants: [],
      setBoundVariables: null,
      setExplicitVariableModes: null,
      variantBoundVariables: [],
      fileVariableCollections: localVariableCollections,
      libraryVariableCollections,
      fileVariableModes: getFileVariableModes(localVariableCollections),
      meta: {
        selectionType: node.type,
        variantCount: 0,
        nodesWithBoundVariables: 0,
        resolvedFromInstance: false,
        errors: collector.errors,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
