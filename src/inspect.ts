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

type ErrorCollector = {
  errors: string[];
};

export type InspectionResult = {
  selectedNodeId: string | null;
  nodeType: string | null;
  name: string | null;
  source: 'component-set' | 'component' | 'instance' | 'unsupported';
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
  fileVariableModes: string[];
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

const resolveVariableMetadata = async (variableId: string | null, collector: ErrorCollector) => {
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

const serializeBoundVariables = async (boundVariables: Record<string, unknown> | undefined, collector: ErrorCollector) => {
  if (!boundVariables) {
    return null;
  }

  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(boundVariables)) {
    const alias = value as { id?: string; type?: string } | undefined;
    const variableId = alias?.id ?? null;
    const resolved = variableId ? await resolveVariableMetadata(variableId, collector) : null;

    output[key] = {
      id: variableId,
      name: resolved?.name ?? null,
      resolvedType: resolved?.resolvedType ?? alias?.type ?? null,
      remote: resolved?.remote ?? false,
      collectionId: resolved?.collectionId ?? null,
      collection: resolved?.collection ?? null,
    };
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

  if ('children' in node && Array.isArray(node.children)) {
    const children = await Promise.all(node.children.map((child) => collectLayerTree(child, root, collector)));
    self.children = children.flat();
  }

  return [self];
};

const getComponentPropertyDefinitions = (node: BaseNode, collector: ErrorCollector) => {
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
    pushError(collector, `Failed to read componentPropertyDefinitions for ${node.name}`, error);
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
          fileVariableModes: localVariableCollections.flatMap((collection) => collection.modes),
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
        fileVariableModes: localVariableCollections.flatMap((collection) => collection.modes),
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
      fileVariableModes: localVariableCollections.flatMap((collection) => collection.modes),
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
      source: node.type === 'COMPONENT_SET' ? 'component-set' : node.type === 'COMPONENT' ? 'component' : 'instance',
      componentPropertyDefinitions: [],
      variants: [],
      setBoundVariables: null,
      setExplicitVariableModes: null,
      variantBoundVariables: [],
      fileVariableCollections: localVariableCollections,
      libraryVariableCollections,
      fileVariableModes: localVariableCollections.flatMap((collection) => collection.modes),
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
