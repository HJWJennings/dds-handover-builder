import { getDocStatus, type DocStatus } from '../store/docStatus';

export type ScanScope = 'page' | 'all';

export interface ComponentListItem {
  id: string;
  /** Display name: the leaf segment after the last "/" in a slash-path name. */
  name: string;
  /** Raw node.name, unmodified. */
  fullName: string;
  type: 'COMPONENT_SET' | 'COMPONENT';
  pageId: string;
  pageName: string;
  isPrivate: boolean;
  status: DocStatus;
}

export interface ComponentGroup {
  key: string;
  label: string;
  items: ComponentListItem[];
}

export interface ScanResult {
  scope: ScanScope;
  groups: ComponentGroup[];
  totalCount: number;
}

export type ScanProgressCallback = (scannedPages: number, totalPages: number) => void;

type TopLevelNode = ComponentSetNode | ComponentNode;

const isPrivateName = (leafName: string) => leafName.startsWith('.') || leafName.startsWith('_');

/** Splits "Input bar/Large" into group "Input bar" and leaf "Large". Returns null group when there's no "/". */
const splitSlashPath = (name: string): { group: string; leaf: string } | null => {
  const lastSlash = name.lastIndexOf('/');
  if (lastSlash <= 0 || lastSlash === name.length - 1) {
    return null;
  }

  return {
    group: name.slice(0, lastSlash).trim(),
    leaf: name.slice(lastSlash + 1).trim(),
  };
};

/** Walks up from the node's parent looking for the nearest SECTION, or a top-level FRAME (direct child of the page). */
const findAncestorGroupName = (node: BaseNode): string | null => {
  let current: BaseNode | null = node.parent;

  while (current && current.type !== 'PAGE') {
    if (current.type === 'SECTION') {
      return current.name;
    }

    if (current.type === 'FRAME' && current.parent?.type === 'PAGE') {
      return current.name;
    }

    current = current.parent;
  }

  return null;
};

/** Group label used both by the list scan and the editor header ("Input bar/Large" -> "Input bar"). */
export const getGroupLabelForNode = (node: ComponentSetNode | ComponentNode): string => {
  const split = splitSlashPath(node.name);
  return split?.group ?? findAncestorGroupName(node) ?? 'Ungrouped';
};

export const collectTopLevelComponents = (page: PageNode): TopLevelNode[] => {
  const found = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });

  return found.filter((node): node is TopLevelNode => {
    if (node.type === 'COMPONENT_SET') {
      return true;
    }

    // Skip variants living inside a component set; only standalone components count.
    return node.parent?.type !== 'COMPONENT_SET';
  });
};

const toListItem = (node: TopLevelNode, page: PageNode): ComponentListItem => {
  const split = splitSlashPath(node.name);
  const leaf = split?.leaf ?? node.name;

  return {
    id: node.id,
    name: leaf,
    fullName: node.name,
    type: node.type,
    pageId: page.id,
    pageName: page.name,
    isPrivate: isPrivateName(leaf),
    status: getDocStatus(node),
  };
};

const groupItems = (entries: Array<{ node: TopLevelNode; page: PageNode }>): ComponentGroup[] => {
  const groups = new Map<string, ComponentGroup>();

  for (const { node, page } of entries) {
    const groupLabel = getGroupLabelForNode(node);
    const key = groupLabel;

    const item = toListItem(node, page);

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { key, label: groupLabel, items: [item] });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      if (a.key === 'Ungrouped') return 1;
      if (b.key === 'Ungrouped') return -1;
      return a.label.localeCompare(b.label);
    });
};

export const scanComponents = async (
  scope: ScanScope,
  onProgress?: ScanProgressCallback,
): Promise<ScanResult> => {
  const entries: Array<{ node: TopLevelNode; page: PageNode }> = [];

  if (scope === 'page') {
    const page = figma.currentPage;
    onProgress?.(0, 1);
    for (const node of collectTopLevelComponents(page)) {
      entries.push({ node, page });
    }
    onProgress?.(1, 1);
  } else {
    await figma.loadAllPagesAsync();
    const pages = figma.root.children;
    const total = pages.length;

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      for (const node of collectTopLevelComponents(page)) {
        entries.push({ node, page });
      }
      onProgress?.(index + 1, total);
      // Yield to the event loop between pages so the UI doesn't freeze on large files.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    scope,
    groups: groupItems(entries),
    totalCount: entries.length,
  };
};
