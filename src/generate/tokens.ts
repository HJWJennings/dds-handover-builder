import type { HandoverTokenRole, TokenRoleDefinition } from './config';
import { TOKEN_ROLE_DEFINITIONS } from './config';
import { SPACING_VALUES } from './layout';

export interface ResolvedTokenRole {
  role: HandoverTokenRole;
  variable: Variable | null;
  value: string;
  report: {
    role: string;
    variableUsed: string | null;
    fallback: string | null;
    reason: string;
    resolvedValue?: string;
    verify?: boolean;
  };
}

export interface ResolvedSpacingToken {
  value: number;
  variable: Variable | null;
  report: { role: string; variableUsed: string | null; fallback: number | null; reason: string };
}

export interface HandoverTokenSet {
  roles: Record<HandoverTokenRole, ResolvedTokenRole>;
  spacing: Record<number, ResolvedSpacingToken>;
  report: Array<ResolvedTokenRole['report'] | ResolvedSpacingToken['report']>;
  errors: string[];
}

const toHex = (color: RGB | RGBA): string =>
  `#${[color.r, color.g, color.b].map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

type ResolvedModeValue = { value: string | number; aliasTarget: string | null };
const tokenValueCache = new Map<string, Promise<ResolvedModeValue>>();

const getModeValue = async (
  variable: Variable,
  modeName: string,
  visited = new Set<string>(),
): Promise<ResolvedModeValue> => {
  if (visited.has(variable.id)) throw new Error(`Alias cycle while resolving ${variable.name}.`);
  const cacheKey = `${variable.id}|${modeName}`;
  const cached = tokenValueCache.get(cacheKey);
  if (cached) return cached;

  const nextVisited = new Set(visited);
  nextVisited.add(variable.id);
  const promise = (async (): Promise<ResolvedModeValue> => {
    const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    if (!collection) throw new Error(`Collection for ${variable.name} is unavailable.`);
    const mode = collection.modes.find((entry) => entry.name === modeName)
      ?? collection.modes.find((entry) => entry.modeId === collection.defaultModeId);
    if (!mode) throw new Error(`No matching or default mode is available in ${collection.name}.`);
    const value = variable.valuesByMode[mode.modeId];
    if (value === undefined) throw new Error(`Mode "${mode.name}" has no value for ${variable.name}.`);

    if (value && typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
      const targetId = (value as VariableAlias).id;
      const target = await figma.variables.getVariableByIdAsync(targetId);
      if (!target) throw new Error(`Alias target ${targetId} is unavailable.`);
      const resolved = await getModeValue(target, modeName, nextVisited);
      return { value: resolved.value, aliasTarget: target.name };
    }

    if (variable.resolvedType === 'COLOR') return { value: toHex(value as RGBA), aliasTarget: null };
    if (typeof value === 'number') return { value, aliasTarget: null };
    throw new Error(`Unexpected ${variable.resolvedType} value for ${variable.name}.`);
  })();
  tokenValueCache.set(cacheKey, promise);
  return promise;
};

const getLocalWebVariables = async (errors: string[]) => {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const collection = collections.find((entry) => entry.name === 'Web');
    if (!collection) return { collection: null, variables: [] as Variable[] };
    const allVariables = await figma.variables.getLocalVariablesAsync();
    return {
      collection,
      variables: allVariables.filter((variable) => variable.variableCollectionId === collection.id),
    };
  } catch (error) {
    errors.push(`Failed to read local Web variables: ${error instanceof Error ? error.message : String(error)}`);
    return { collection: null, variables: [] as Variable[] };
  }
};

export const resolveHandoverTokens = async (): Promise<HandoverTokenSet> => {
  const errors: string[] = [];
  const { variables: local } = await getLocalWebVariables(errors);
  let libraryDescriptors: LibraryVariable[] | null = null;
  const importedLibraryVariables = new Map<string, Variable | null>();

  const loadWebLibraryDescriptors = async (): Promise<LibraryVariable[]> => {
    if (libraryDescriptors) return libraryDescriptors;
    libraryDescriptors = [];
    try {
      const available = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
      const webCollection = available.find((entry) => entry.name === 'Web' && entry.libraryName === 'DDS Web library');
      if (!webCollection) return libraryDescriptors;
      libraryDescriptors = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(webCollection.key);
    } catch (error) {
      errors.push(`Failed to read DDS Web library variables: ${error instanceof Error ? error.message : String(error)}`);
    }
    return libraryDescriptors;
  };

  const importLibraryVariable = async (descriptor: LibraryVariable): Promise<Variable | null> => {
    if (importedLibraryVariables.has(descriptor.key)) return importedLibraryVariables.get(descriptor.key) ?? null;
    try {
      const variable = await figma.variables.importVariableByKeyAsync(descriptor.key);
      const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
      if (collection?.name !== 'Web') {
        errors.push(`Library variable ${descriptor.name} did not resolve to a collection named Web.`);
        importedLibraryVariables.set(descriptor.key, null);
        return null;
      }
      importedLibraryVariables.set(descriptor.key, variable);
      return variable;
    } catch (error) {
      errors.push(`Failed to import library token ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`);
      importedLibraryVariables.set(descriptor.key, null);
      return null;
    }
  };

  const findExactVariable = async (name: string): Promise<{ variable: Variable | null; reason: string }> => {
    const localMatches = local.filter((variable) => variable.name === name && variable.resolvedType === 'COLOR');
    if (localMatches.length === 1) return { variable: localMatches[0], reason: 'Matched exact name in local Web collection.' };
    if (localMatches.length > 1) return { variable: null, reason: `Multiple local Web variables named ${name}; fallback used.` };
    const descriptors = (await loadWebLibraryDescriptors()).filter((variable) => variable.name === name && variable.resolvedType === 'COLOR');
    if (descriptors.length === 1) {
      const variable = await importLibraryVariable(descriptors[0]);
      if (variable) return { variable, reason: 'Matched exact name in DDS Web library.' };
      return { variable: null, reason: `Matched library name ${name}, but its value could not be read; fallback used.` };
    }
    if (descriptors.length > 1) return { variable: null, reason: `Multiple DDS Web library variables named ${name}; fallback used.` };
    return { variable: null, reason: `NOT FOUND in Web: ${name}; fallback used.` };
  };

  const findValueVariable = async (definition: TokenRoleDefinition): Promise<{ variable: Variable | null; reason: string }> => {
    const matching = async (source: Variable[]) => {
      const matches: Variable[] = [];
      for (const variable of source.filter((entry) => entry.name.startsWith(definition.collectionPathPrefix ?? '') && entry.resolvedType === 'COLOR')) {
        try {
          const value = await getModeValue(variable, 'Tesco');
          if (value.value === definition.matchTescoHex) matches.push(variable);
        } catch (error) {
          errors.push(`Failed to inspect Tesco value for ${variable.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return matches;
    };

    const localMatches = await matching(local);
    if (localMatches.length === 1) return { variable: localMatches[0], reason: `Matched unique local Tesco value ${definition.matchTescoHex}.` };
    if (localMatches.length > 1) return { variable: null, reason: `Several local Web variables matched ${definition.matchTescoHex}; fallback used.` };

    const libraryMatches: Variable[] = [];
    for (const descriptor of (await loadWebLibraryDescriptors()).filter((entry) => entry.name.startsWith(definition.collectionPathPrefix ?? '') && entry.resolvedType === 'COLOR')) {
      const variable = await importLibraryVariable(descriptor);
      if (!variable) continue;
      try {
        const value = await getModeValue(variable, 'Tesco');
        if (value.value === definition.matchTescoHex) libraryMatches.push(variable);
      } catch (error) {
        errors.push(`Failed to inspect Tesco value for library token ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (libraryMatches.length === 1) return { variable: libraryMatches[0], reason: `Matched unique DDS Web library Tesco value ${definition.matchTescoHex}.` };
    if (libraryMatches.length > 1) return { variable: null, reason: `Several DDS Web library variables matched ${definition.matchTescoHex}; fallback used.` };
    return { variable: null, reason: `NOT FOUND in Web: no unique value match for ${definition.role}; fallback used.` };
  };

  const chooseVariable = async (definition: TokenRoleDefinition) => {
    if (definition.candidates) {
      let lastReason = '';
      for (const candidate of definition.candidates) {
        const match = await findExactVariable(candidate);
        if (match.variable || match.reason.includes('Multiple') || match.reason.startsWith('Matched library name')) return match;
        lastReason = match.reason;
      }
      if (definition.collectionPathPrefix && definition.matchTescoHex) {
        const valueMatch = await findValueVariable(definition);
        if (valueMatch.variable || valueMatch.reason.includes('Several')) return valueMatch;
        return { variable: null, reason: `NOT FOUND in Web: no exact name or unique value match. ${valueMatch.reason}` };
      }
      return { variable: null, reason: `NOT FOUND in Web: ${definition.candidates.join(' or ')}. ${lastReason}` };
    }
    return findValueVariable(definition);
  };

  const report: HandoverTokenSet['report'] = [];
  const roles = {} as Record<HandoverTokenRole, ResolvedTokenRole>;
  for (const definition of TOKEN_ROLE_DEFINITIONS) {
    let chosen: { variable: Variable | null; reason: string };
    try {
      chosen = await chooseVariable(definition);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to resolve token role ${definition.role}: ${message}`);
      chosen = { variable: null, reason: `${message}; fallback used.` };
    }

    let value = definition.fallback;
    let variable: Variable | null = chosen.variable;
    let reason = chosen.reason;
    let resolvedValue: string | undefined;
    if (variable) {
      try {
        const resolved = await getModeValue(variable, 'Tesco');
        if (typeof resolved.value !== 'string') throw new Error('Expected a color value.');
        resolvedValue = resolved.value;
        value = resolved.value;
        if (resolved.value !== definition.fallback) {
          reason = `value differs from expected: resolved ${resolved.value}, expected ${definition.fallback}; variable remains bound.`;
        } else {
          reason = `resolved ${resolved.value}, expected ${definition.fallback}; ${chosen.reason}`;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to resolve ${definition.role}: ${message}`);
        reason = `bound, value unverified: ${message}`;
      }
    }

    const resolved: ResolvedTokenRole = {
      role: definition.role,
      variable,
      value,
      report: {
        role: definition.role,
        variableUsed: variable?.name ?? null,
        fallback: variable ? null : definition.fallback,
        reason: definition.verify ? `${reason} Verify this provisional value.` : reason,
        resolvedValue,
        ...(definition.verify ? { verify: true } : {}),
      },
    };
    roles[definition.role] = resolved;
    report.push(resolved.report);
  }

  const spacing: Record<number, ResolvedSpacingToken> = {};
  for (const value of SPACING_VALUES) {
    const name = `Spacing/Space-${value}`;
    const localMatches = local.filter((variable) => variable.name === name && variable.resolvedType === 'FLOAT');
    let matches = localMatches;
    let source = 'local Web';
    if (matches.length === 0) {
      const descriptors = (await loadWebLibraryDescriptors()).filter((variable) => variable.name === name && variable.resolvedType === 'FLOAT');
      matches = [];
      for (const descriptor of descriptors) {
        const imported = await importLibraryVariable(descriptor);
        if (imported) matches.push(imported);
      }
      source = 'DDS Web library';
    }
    const variable = matches.length === 1 ? matches[0] : null;
    const reason = matches.length === 1
      ? `Matched ${source} variable.`
      : matches.length > 1
        ? `Multiple Web variables named ${name}; raw value used.`
        : `No Web variable named ${name}; raw value used.`;
    const resolved: ResolvedSpacingToken = {
      value,
      variable,
      report: { role: `spacing-${value}`, variableUsed: variable?.name ?? null, fallback: variable ? null : value, reason },
    };
    spacing[value] = resolved;
    report.push(resolved.report);
  }

  return { roles, spacing, report, errors };
};

export const makeSolidPaint = (color: string, variable: Variable | null, opacity = 1): SolidPaint => {
  const match = /^#([0-9A-F]{6})$/i.exec(color);
  const hex = match?.[1] ?? 'FFFFFF';
  const paint: SolidPaint = {
    type: 'SOLID',
    color: {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
    },
    opacity,
  };
  return variable ? figma.variables.setBoundVariableForPaint(paint, 'color', variable) : paint;
};

export const bindSpacing = (node: SceneNode, field: VariableBindableNodeField, token: ResolvedSpacingToken) => {
  if (token.variable) node.setBoundVariable(field, token.variable);
};
