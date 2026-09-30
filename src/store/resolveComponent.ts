export type DocumentableNode = ComponentSetNode | ComponentNode;

/** Resolves any selection (instance, variant, component, set) to the node its ComponentDoc lives on. */
export const resolveDocumentableNode = async (node: BaseNode | null): Promise<DocumentableNode | null> => {
  if (!node) {
    return null;
  }

  let selected: BaseNode = node;

  if (selected.type === 'INSTANCE') {
    try {
      const mainComponent = await selected.getMainComponentAsync();
      if (!mainComponent) {
        return null;
      }
      selected = mainComponent;
    } catch {
      return null;
    }
  }

  if (selected.type === 'COMPONENT' && selected.parent?.type === 'COMPONENT_SET') {
    return selected.parent;
  }

  if (selected.type === 'COMPONENT' || selected.type === 'COMPONENT_SET') {
    return selected;
  }

  return null;
};
