import type { ComponentDoc } from '../store/types';
import { getDocStatus, getOrCreateDoc, type DocumentableNode } from '../store/docStatus';
import { GENERATED_DATA_KEY, GENERATED_DATA_NAMESPACE, HANDOVER_OUTPUT_PAGE, HANDOVER_SECTIONS, EMPTY_SECTIONS, type HandoverSectionDefinition, type HandoverTokenRole } from './config';
import {
  CODE_BLOCK_PADDING,
  CONTENT_WIDTH,
  DOC_WIDTH,
  DIVIDER_HEIGHT,
  FRAME_MIN_HEIGHT,
  GLANCE_COLUMNS,
  GLANCE_COLUMN_GAP,
  GLANCE_HORIZONTAL_PADDING,
  GLANCE_ITEM_TEXT_GAP,
  GLANCE_VERTICAL_PADDING,
  HEADER_TEXT_GAP,
  HEADER_VERTICAL_PADDING,
  LAYOUT_CHECK_MIN_PARENT_FRACTION,
  LAYOUT_CHECK_MIN_TEXT_WIDTH,
  PAGE_GAP,
  PAGE_PADDING,
  ROOT_SECTION_GAP,
  SECTION_GAP,
  SECTION_PADDING,
  SECTION_NUMBERS,
  SLOT_DASH_PATTERN,
  SLOT_PADDING,
  SLOT_STROKE_WEIGHT,
} from './layout';
import { loadGenerationFonts, type GenerationFonts } from './fonts';
import { appendLinks, appendMarkdown, appendStyledText, type HandoverTextRole } from './markdown';
import { resolveHandoverTokens, type HandoverTokenSet, makeSolidPaint, bindSpacing } from './tokens';

export interface GenerationContext {
  outputPage: PageNode;
  fonts: GenerationFonts;
  tokens: HandoverTokenSet;
}

export interface GeneratedHandoverResult {
  id: string;
  name: string;
  action: 'generated' | 'replaced';
  frame: FrameNode;
  emptySectionCount: number;
  collapsedTextPaths: string[];
  tokenBindingReadback: string[];
  fontReport: GenerationFonts['report'];
  tokenReport: HandoverTokenSet['report'];
  errors: string[];
}

const ensureOutputPage = async (): Promise<PageNode> => {
  await figma.loadAllPagesAsync();
  const existing = figma.root.children.find((page) => page.name === HANDOVER_OUTPUT_PAGE);
  const page = existing ?? figma.createPage();
  if (!existing) page.name = HANDOVER_OUTPUT_PAGE;
  await page.loadAsync();
  return page;
};

const createAutoFrame = (name: string, width: number, tokens: HandoverTokenSet, fillRole?: keyof HandoverTokenSet['roles']): FrameNode => {
  const frame = figma.createFrame();
  frame.name = name;
  frame.resize(width, FRAME_MIN_HEIGHT);
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.counterAxisAlignItems = 'MIN';
  frame.itemSpacing = ROOT_SECTION_GAP;
  frame.fills = fillRole ? [makeSolidPaint(tokens.roles[fillRole].value, tokens.roles[fillRole].variable)] : [];
  return frame;
};

const bindPadding = (frame: FrameNode, values: { top: number; right: number; bottom: number; left: number }, tokens: HandoverTokenSet) => {
  frame.paddingTop = values.top;
  frame.paddingRight = values.right;
  frame.paddingBottom = values.bottom;
  frame.paddingLeft = values.left;
  const bindings: Array<[VariableBindableNodeField, number]> = [
    ['paddingTop', values.top],
    ['paddingRight', values.right],
    ['paddingBottom', values.bottom],
    ['paddingLeft', values.left],
  ];
  for (const [field, spacing] of bindings) {
    const token = tokens.spacing[spacing];
    if (token?.variable) bindSpacing(frame, field, token);
  }
};

const setItemSpacing = (frame: FrameNode, value: number, tokens: HandoverTokenSet) => {
  frame.itemSpacing = value;
  const token = tokens.spacing[value];
  if (token?.variable) bindSpacing(frame, 'itemSpacing', token);
};

const addText = (
  parent: FrameNode,
  value: string,
  role: HandoverTextRole,
  ctx: GenerationContext,
  name: string,
  options: { singleLine?: boolean; opacity?: number } = {},
): TextNode => {
  const text = appendStyledText(parent, value || ' ', role, ctx.fonts, ctx.tokens, {
    name,
    resizeMode: options.singleLine ? 'WIDTH_AND_HEIGHT' : 'HEIGHT',
  });
  text.textAlignHorizontal = 'LEFT';
  if (options.opacity !== undefined) text.opacity = options.opacity;
  return text;
};

const addGlanceCell = (parent: FrameNode, key: string, label: string, value: string, muted: boolean, ctx: GenerationContext) => {
  const cell = createAutoFrame(`#glance/${key}/cell`, CONTENT_WIDTH / GLANCE_COLUMNS, ctx.tokens);
  setItemSpacing(cell, GLANCE_ITEM_TEXT_GAP, ctx.tokens);
  addText(cell, label, 'caption', ctx, `#glance/${key}/label`, { singleLine: true });
  addText(cell, value, 'caption', ctx, `#glance/${key}`, { singleLine: true, opacity: muted ? 0.55 : 1 });
  parent.appendChild(cell);
  cell.layoutSizingHorizontal = 'FILL';
};

const addSlot = (parent: FrameNode, key: string, ctx: GenerationContext, phase?: 5 | 6, manual = false) => {
  const slot = createAutoFrame(`#slot/${key}`, CONTENT_WIDTH - 2 * SLOT_PADDING, ctx.tokens);
  slot.strokes = [makeSolidPaint(ctx.tokens.roles.divider.value, ctx.tokens.roles.divider.variable)];
  slot.strokeWeight = SLOT_STROKE_WEIGHT;
  slot.dashPattern = [...SLOT_DASH_PATTERN];
  bindPadding(slot, { top: SLOT_PADDING, right: SLOT_PADDING, bottom: SLOT_PADDING, left: SLOT_PADDING }, ctx.tokens);
  addText(slot, manual ? 'Manual section' : `Auto-generated in Phase ${phase ?? 5}`, 'caption', ctx, `#slot/${key}/placeholder`, { singleLine: true, opacity: 0.6 });
  parent.appendChild(slot);
  slot.layoutSizingHorizontal = 'FILL';
  return slot;
};

const addSectionFrame = (root: FrameNode, section: HandoverSectionDefinition, index: number, count: number, ctx: GenerationContext) => {
  const sectionFrame = createAutoFrame(`#section/${section.key}`, DOC_WIDTH, ctx.tokens, 'pageBackground');
  bindPadding(sectionFrame, { top: SECTION_PADDING, right: SECTION_PADDING, bottom: SECTION_PADDING, left: SECTION_PADDING }, ctx.tokens);
  setItemSpacing(sectionFrame, SECTION_GAP, ctx.tokens);
  const title = SECTION_NUMBERS ? `${index + 1} ${section.title}` : section.title;
  const heading = addText(sectionFrame, title, 'heading', ctx, `#section/${section.key}/heading`);
  const content = createAutoFrame(`#section/${section.key}/content`, CONTENT_WIDTH, ctx.tokens);
  setItemSpacing(content, SECTION_GAP, ctx.tokens);
  sectionFrame.appendChild(content);
  content.layoutSizingHorizontal = 'FILL';
  if (index < count - 1) {
    const divider = createAutoFrame(`#divider/${section.key}`, CONTENT_WIDTH, ctx.tokens, 'divider');
    divider.resize(CONTENT_WIDTH, DIVIDER_HEIGHT);
    sectionFrame.appendChild(divider);
    divider.layoutSizingHorizontal = 'FILL';
  }
  root.appendChild(sectionFrame);
  sectionFrame.layoutSizingHorizontal = 'FILL';
  return { content, heading };
};

const sourcePageName = (component: DocumentableNode): string => {
  let current: BaseNode | null = component;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current?.type === 'PAGE' ? current.name : 'Unknown page';
};

const statusText = (component: DocumentableNode, doc: ComponentDoc | null): string => {
  if (!doc) return 'Not documented';
  return getDocStatus(component) === 'documented' ? 'Documented' : 'Draft';
};

const setWebTescoMode = async (root: FrameNode): Promise<string> => {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const web = collections.find((collection) => collection.name === 'Web');
    if (!web) return 'Web collection not found; could not set the Tesco mode.';
    const tesco = web.modes.find((mode) => mode.name === 'Tesco');
    if (!tesco) return 'Tesco mode not found in Web; could not set the explicit mode.';
    root.setExplicitVariableModeForCollection(web, tesco.modeId);
    return 'Web explicit mode: Tesco.';
  } catch (error) {
    return `Could not set Web Tesco mode: ${error instanceof Error ? error.message : String(error)}`;
  }
};

const resolvedColorHex = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || !('r' in value) || !('g' in value) || !('b' in value)) return null;
  const color = value as RGB;
  return `#${[color.r, color.g, color.b].map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

const readFillBinding = async (role: string, node: SceneNode, token: HandoverTokenSet['roles'][HandoverTokenRole]): Promise<string> => {
  const boundVariables = (node as unknown as { boundVariables?: { fills?: readonly VariableAlias[] } }).boundVariables;
  const alias = boundVariables?.fills?.find((entry) => Boolean(entry?.id));
  if (!alias) {
    return token.report.reason.startsWith('NOT FOUND in Web')
      ? `${role} → fallback ${token.value} · NOT FOUND in Web`
      : `${role} → fallback ${token.value} · binding missing`;
  }

  let variable: Variable | null = null;
  let collectionName = 'collection unresolved';
  try {
    variable = await figma.variables.getVariableByIdAsync(alias.id);
    if (variable) {
      const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
      collectionName = collection?.name ?? collectionName;
    }
  } catch {
    return `${role} → ${alias.id} [${collectionName}] · value unresolved`;
  }
  if (!variable) return `${role} → ${alias.id} [${collectionName}] · value unresolved`;

  try {
    const resolved = variable.resolveForConsumer(node);
    const hex = resolvedColorHex(resolved.value);
    return hex
      ? `${role} → ${variable.name} [${collectionName}] · resolved ${hex}`
      : `${role} → ${variable.name} [${collectionName}] · value unresolved`;
  } catch {
    return `${role} → ${variable.name} [${collectionName}] · value unresolved`;
  }
};

const getCollapsedTextPaths = (root: FrameNode): string[] => {
  const paths: string[] = [];
  const visit = (node: BaseNode, ancestors: string[]) => {
    const path = [...ancestors, node.name];
    if (node.type === 'TEXT' && node.characters.length > 3) {
      const parent = node.parent as unknown as { width?: number; paddingLeft?: number; paddingRight?: number } | null;
      const innerWidth = parent && typeof parent.width === 'number' ? parent.width - (parent.paddingLeft ?? 0) - (parent.paddingRight ?? 0) : 0;
      if (node.width < LAYOUT_CHECK_MIN_TEXT_WIDTH || (node.textAutoResize === 'HEIGHT' && innerWidth > 0 && node.width < innerWidth * LAYOUT_CHECK_MIN_PARENT_FRACTION)) paths.push(path.join(' / '));
    }
    if ('children' in node && Array.isArray(node.children)) for (const child of node.children) visit(child, path);
  };
  visit(root, []);
  return paths;
};

const addAtAGlance = (root: FrameNode, component: DocumentableNode, doc: ComponentDoc | null, fields: ComponentDoc['fields'], ctx: GenerationContext) => {
  const strip = createAutoFrame('#glance', DOC_WIDTH, ctx.tokens, 'pageBackground');
  strip.layoutMode = 'HORIZONTAL';
  strip.primaryAxisSizingMode = 'FIXED';
  strip.counterAxisSizingMode = 'AUTO';
  strip.counterAxisAlignItems = 'MIN';
  bindPadding(strip, { top: GLANCE_VERTICAL_PADDING, right: GLANCE_HORIZONTAL_PADDING, bottom: GLANCE_VERTICAL_PADDING, left: GLANCE_HORIZONTAL_PADDING }, ctx.tokens);
  setItemSpacing(strip, GLANCE_COLUMN_GAP, ctx.tokens);
  const variantCount = component.type === 'COMPONENT_SET' ? component.children.length : 0;
  const componentType = component.type === 'COMPONENT_SET' ? `Component set · ${variantCount} variants` : 'Component';
  addGlanceCell(strip, 'status', 'Status', statusText(component, doc), false, ctx);
  addGlanceCell(strip, 'updated', 'Updated', doc?.updatedAt ? new Date(doc.updatedAt).toLocaleDateString() : 'Not documented yet.', !doc?.updatedAt, ctx);
  addGlanceCell(strip, 'updated-by', 'Updated by', doc?.updatedBy || 'Not documented yet.', !doc?.updatedBy, ctx);
  addGlanceCell(strip, 'type', 'Type', componentType, false, ctx);
  addGlanceCell(strip, 'storybook-path', 'Storybook path', fields.storybookPath.trim() || 'Not documented yet.', !fields.storybookPath.trim(), ctx);
  root.appendChild(strip);
  strip.layoutSizingHorizontal = 'FILL';
};

const hasMeaningfulContent = (key: string, fields: ComponentDoc['fields']): boolean => {
  switch (key) {
    case 'when-to-use': return Boolean(fields.whenToUse.trim());
    case 'when-not-to-use': return Boolean(fields.whenNotToUse.trim());
    case 'storybook-hierarchy': return Boolean(fields.storybookPath.trim() || fields.storybookControls.trim());
    case 'responsive': return Boolean(fields.responsive.trim());
    case 'content-guidance': return Boolean(fields.contentGuidance.trim());
    case 'accessibility': return Boolean(fields.accessibility.trim() || fields.links.length > 0);
    case 'ai-guidance': return Boolean(fields.aiGuidance.trim());
    case 'configuration-behaviour': return Boolean(fields.behaviourNotes.trim());
    default: return true;
  }
};

const fillSection = (content: FrameNode, key: string, fields: ComponentDoc['fields'], ctx: GenerationContext): boolean => {
  if (key === 'visual-reference') {
    addSlot(content, 'visual-reference', ctx, 5);
    return true;
  }
  if (key === 'variants') {
    addSlot(content, 'variants', ctx, 5);
    addSlot(content, 'on-dark', ctx, 5);
    addSlot(content, 'theme', ctx, 5);
    return true;
  }
  if (key === 'smaller-theme') {
    addSlot(content, 'dds-vs-eds', ctx, undefined, true);
    return true;
  }
  if (key === 'design-tokens') {
    addSlot(content, 'design-tokens', ctx, 6);
    return true;
  }
  if (key === 'configuration-behaviour') {
    addSlot(content, 'configuration', ctx, 6);
    if (fields.behaviourNotes.trim()) appendMarkdown(content, fields.behaviourNotes, ctx.fonts, ctx.tokens);
    else addText(content, 'Not documented yet.', 'body', ctx, 'Empty behaviour notes', { opacity: 0.55 });
    return Boolean(fields.behaviourNotes.trim());
  }
  if (key === 'structure-breakdown') {
    addSlot(content, 'anatomy', ctx, 5);
    return true;
  }
  if (key === 'interactive-flows') {
    addSlot(content, 'interactions', ctx, 6);
    return true;
  }
  if (key === 'key-changes') {
    addText(content, 'None recorded.', 'body', ctx, 'Key changes empty');
    return true;
  }
  if (key === 'storybook-hierarchy') {
    if (fields.storybookPath.trim()) addText(content, fields.storybookPath, 'body', ctx, 'Storybook breadcrumb', { singleLine: true });
    if (fields.storybookControls.trim()) appendMarkdown(content, fields.storybookControls, ctx.fonts, ctx.tokens);
    if (!fields.storybookPath.trim() && !fields.storybookControls.trim()) addText(content, 'Not documented yet.', 'body', ctx, 'Empty Storybook hierarchy', { opacity: 0.55 });
    return Boolean(fields.storybookPath.trim() || fields.storybookControls.trim());
  }
  if (key === 'accessibility') {
    if (fields.accessibility.trim()) appendMarkdown(content, fields.accessibility, ctx.fonts, ctx.tokens);
    const linksAdded = appendLinks(content, fields.links, ctx.fonts, ctx.tokens);
    if (!fields.accessibility.trim() && !linksAdded) addText(content, 'Not documented yet.', 'body', ctx, 'Empty accessibility', { opacity: 0.55 });
    return Boolean(fields.accessibility.trim() || linksAdded);
  }
  if (key === 'ai-guidance') {
    addText(content, 'For AI tools', 'h3', ctx, '#section/ai-guidance/label');
    if (fields.aiGuidance.trim()) appendMarkdown(content, fields.aiGuidance, ctx.fonts, ctx.tokens);
    else addText(content, 'Not documented yet.', 'body', ctx, 'Empty AI guidance', { opacity: 0.55 });
    return Boolean(fields.aiGuidance.trim());
  }

  const fieldMap: Record<string, keyof ComponentDoc['fields'] | undefined> = {
    'when-to-use': 'whenToUse',
    'when-not-to-use': 'whenNotToUse',
    responsive: 'responsive',
    'content-guidance': 'contentGuidance',
  };
  const field = fieldMap[key];
  const markdown = field ? fields[field] as string : '';
  if (markdown.trim()) appendMarkdown(content, markdown, ctx.fonts, ctx.tokens);
  else addText(content, 'Not documented yet.', 'body', ctx, `Empty ${key}`, { opacity: 0.55 });
  return Boolean(markdown.trim());
};

const buildFrame = async (component: DocumentableNode, doc: ComponentDoc | null, ctx: GenerationContext): Promise<{ frame: FrameNode; band: FrameNode; sectionHeading: TextNode; modeReport: string; emptySectionCount: number }> => {
  const fields = doc?.fields ?? getOrCreateDoc(component).fields;
  const frame = createAutoFrame(`Handover — ${component.name.replace(/^[._]+/, '')}`, DOC_WIDTH, ctx.tokens, 'pageBackground');
  frame.resize(DOC_WIDTH, FRAME_MIN_HEIGHT);
  frame.clipsContent = false;
  setItemSpacing(frame, ROOT_SECTION_GAP, ctx.tokens);
  const modeReport = await setWebTescoMode(frame);

  const header = createAutoFrame('#header-band', DOC_WIDTH, ctx.tokens, 'bandFill');
  bindPadding(header, { top: HEADER_VERTICAL_PADDING, right: PAGE_PADDING, bottom: HEADER_VERTICAL_PADDING, left: PAGE_PADDING }, ctx.tokens);
  setItemSpacing(header, HEADER_TEXT_GAP, ctx.tokens);
  addText(header, sourcePageName(component), 'category', ctx, '#category', { singleLine: true });
  addText(header, component.name.replace(/^[._]+/, ''), 'title', ctx, '#title');
  addText(header, fields.purpose.trim() || 'Not documented yet.', 'summary', ctx, '#summary', { opacity: fields.purpose.trim() ? 1 : 0.55 });
  frame.appendChild(header);
  header.layoutSizingHorizontal = 'FILL';

  addAtAGlance(frame, component, doc, fields, ctx);
  let emptySectionCount = 0;
  const sections = EMPTY_SECTIONS === 'placeholder'
    ? HANDOVER_SECTIONS
    : HANDOVER_SECTIONS.filter((section) => section.slots || section.key === 'key-changes' || hasMeaningfulContent(section.key, fields));
  let firstSectionHeading: TextNode | null = null;
  sections.forEach((section, index) => {
    const builtSection = addSectionFrame(frame, section, index, sections.length, ctx);
    firstSectionHeading ??= builtSection.heading;
    const content = builtSection.content;
    if (!fillSection(content, section.key, fields, ctx)) emptySectionCount += 1;
  });

  const footer = createAutoFrame('#footer-band', DOC_WIDTH, ctx.tokens, 'bandFill');
  bindPadding(footer, { top: PAGE_PADDING, right: PAGE_PADDING, bottom: PAGE_PADDING, left: PAGE_PADDING }, ctx.tokens);
  addText(footer, figma.root.name, 'footer', ctx, '#footer', { singleLine: true });
  frame.appendChild(footer);
  footer.layoutSizingHorizontal = 'FILL';
  if (!firstSectionHeading) throw new Error('No handover section heading was generated.');
  return { frame, band: header, sectionHeading: firstSectionHeading, modeReport, emptySectionCount };
};

export const prepareHandoverEnvironment = async (): Promise<GenerationContext> => {
  const fonts = await loadGenerationFonts();
  const tokens = await resolveHandoverTokens();
  await figma.loadAllPagesAsync();
  const page = figma.root.children.find((child) => child.name === HANDOVER_OUTPUT_PAGE) ?? figma.createPage();
  if (page.name !== HANDOVER_OUTPUT_PAGE) page.name = HANDOVER_OUTPUT_PAGE;
  await page.loadAsync();
  return { outputPage: page, fonts, tokens };
};

export const findHandoverFrame = async (page: PageNode, componentId: string): Promise<FrameNode | null> =>
  page.findAll((node) => node.getSharedPluginData(GENERATED_DATA_NAMESPACE, GENERATED_DATA_KEY) === componentId)
    .find((node): node is FrameNode => node.type === 'FRAME') ?? null;

export const buildHandoverDoc = async (
  component: DocumentableNode,
  doc: ComponentDoc | null,
  ctx: GenerationContext,
): Promise<GeneratedHandoverResult> => {
  const previous = await findHandoverFrame(ctx.outputPage, component.id);
  const { frame, band, sectionHeading, modeReport, emptySectionCount } = await buildFrame(component, doc, ctx);
  const existingFrames = ctx.outputPage.children.filter((node): node is FrameNode => node.type === 'FRAME' && node.id !== previous?.id);
  const rightmost = existingFrames.reduce((farRight, node) => Math.max(farRight, node.x + node.width), 0);
  frame.x = previous ? previous.x : rightmost === 0 ? 0 : rightmost + PAGE_GAP;
  frame.y = previous ? previous.y : 0;
  ctx.outputPage.appendChild(frame);
  frame.setSharedPluginData(GENERATED_DATA_NAMESPACE, GENERATED_DATA_KEY, component.id);

  try {
    const collapsedTextPaths = getCollapsedTextPaths(frame);
    console.log('[generate] layout check collapsed text layer paths', collapsedTextPaths);
    const tokenBindingReadback = [
      await readFillBinding('bandFill', band, ctx.tokens.roles.bandFill),
      await readFillBinding('heading', sectionHeading, ctx.tokens.roles.heading),
      modeReport,
    ];
    if (previous && !previous.removed) previous.remove();
    return {
      id: component.id,
      name: component.name,
      action: previous ? 'replaced' : 'generated',
      frame,
      emptySectionCount,
      collapsedTextPaths,
      tokenBindingReadback,
      fontReport: ctx.fonts.report,
      tokenReport: ctx.tokens.report,
      errors: ctx.tokens.errors.concat(ctx.fonts.report.errors),
    };
  } catch (error) {
    if (!frame.removed) frame.remove();
    throw error;
  }
};
