import { parseMarkdown, type BlockNode, type InlineNode } from '../shared/markdown';
import type { ComponentDoc } from '../store/types';
import type { GenerationFonts } from './fonts';
import { bindSpacing, makeSolidPaint, type HandoverTokenSet, type ResolvedTokenRole } from './tokens';
import { CODE_BLOCK_FONT_SIZE, CODE_BLOCK_GAP, CODE_BLOCK_PADDING, TEXT_SCALE } from './layout';

export type HandoverTextRole = keyof typeof TEXT_SCALE;
export type TextResizeMode = 'HEIGHT' | 'WIDTH_AND_HEIGHT';

const colorForTextRole = (role: HandoverTextRole, tokens: HandoverTokenSet): ResolvedTokenRole => {
  if (role === 'title' || role === 'category' || role === 'summary' || role === 'footer') return tokens.roles.textOnDark;
  if (role === 'heading' || role === 'h3') return tokens.roles.heading;
  if (role === 'caption') return tokens.roles.textBody;
  return tokens.roles.textBody;
};

const fontForRole = (role: HandoverTextRole, fonts: GenerationFonts) =>
  ('bold' in TEXT_SCALE[role] && TEXT_SCALE[role].bold) ? fonts.bold : fonts.body;

export const appendStyledText = (
  parent: FrameNode,
  characters: string,
  role: HandoverTextRole,
  fonts: GenerationFonts,
  tokens: HandoverTokenSet,
  options: { name?: string; resizeMode?: TextResizeMode; font?: FontName; fontSize?: number } = {},
): TextNode => {
  const text = figma.createText();
  const style = TEXT_SCALE[role];
  parent.appendChild(text);
  text.fontName = options.font ?? fontForRole(role, fonts);
  text.characters = characters || ' ';
  text.layoutSizingHorizontal = options.resizeMode === 'WIDTH_AND_HEIGHT' ? 'HUG' : 'FILL';
  text.textAutoResize = options.resizeMode ?? 'HEIGHT';
  text.textAlignHorizontal = 'LEFT';
  text.name = options.name ?? (characters.slice(0, 48) || 'Text');
  text.fontSize = style.size;
  text.lineHeight = { unit: 'PIXELS', value: style.lineHeight };
  if (options.fontSize !== undefined) text.fontSize = options.fontSize;
  const color = colorForTextRole(role, tokens);
  text.fills = [makeSolidPaint(color.value, color.variable)];
  return text;
};

type TextRun = { start: number; end: number; style: 'bold' | 'italic' | 'strike' | 'code' | 'link'; value?: string };

const flattenInline = (nodes: InlineNode[], runs: TextRun[]): string => {
  let output = '';
  for (const node of nodes) {
    const start = output.length;
    if (node.type === 'text') output += node.value;
    else if (node.type === 'code') {
      output += node.value;
      runs.push({ start, end: output.length, style: 'code' });
    } else {
      const style: TextRun['style'] | null = node.type === 'bold' ? 'bold'
        : node.type === 'italic' ? 'italic'
          : node.type === 'strikethrough' ? 'strike'
            : node.type === 'link' ? 'link' : null;
      const value = node.type === 'link' ? node.href : undefined;
      const childRuns: TextRun[] = [];
      const childText = flattenInline(node.children, childRuns);
      output += childText;
      runs.push(...childRuns.map((run) => ({ ...run, start: run.start + start, end: run.end + start })));
      if (style) runs.push({ start, end: output.length, style, value });
    }
  }
  return output;
};

const applyRuns = (text: TextNode, runs: TextRun[], fonts: GenerationFonts) => {
  for (const run of runs) {
    if (run.end <= run.start) continue;
    if (run.style === 'bold') text.setRangeFontName(run.start, run.end, fonts.bold);
    else if (run.style === 'italic' && fonts.italic) text.setRangeFontName(run.start, run.end, fonts.italic);
    else if (run.style === 'strike') text.setRangeTextDecoration(run.start, run.end, 'STRIKETHROUGH');
    else if (run.style === 'code') text.setRangeFontName(run.start, run.end, fonts.mono);
    else if (run.style === 'link' && run.value) text.setRangeHyperlink(run.start, run.end, { type: 'URL', value: run.value });
  }
};

const inlineText = (nodes: InlineNode[]) => {
  const runs: TextRun[] = [];
  const text = flattenInline(nodes, runs);
  return { text, runs };
};

const appendBlock = (container: FrameNode, block: BlockNode, fonts: GenerationFonts, tokens: HandoverTokenSet) => {
  if (block.type === 'codeBlock') {
    const codeFrame = figma.createFrame();
    codeFrame.name = 'Code block';
    codeFrame.layoutMode = 'VERTICAL';
    codeFrame.primaryAxisSizingMode = 'AUTO';
    codeFrame.counterAxisSizingMode = 'FIXED';
    codeFrame.paddingTop = CODE_BLOCK_PADDING;
    codeFrame.paddingRight = CODE_BLOCK_PADDING;
    codeFrame.paddingBottom = CODE_BLOCK_PADDING;
    codeFrame.paddingLeft = CODE_BLOCK_PADDING;
    bindSpacing(codeFrame, 'paddingTop', tokens.spacing[CODE_BLOCK_PADDING]);
    bindSpacing(codeFrame, 'paddingRight', tokens.spacing[CODE_BLOCK_PADDING]);
    bindSpacing(codeFrame, 'paddingBottom', tokens.spacing[CODE_BLOCK_PADDING]);
    bindSpacing(codeFrame, 'paddingLeft', tokens.spacing[CODE_BLOCK_PADDING]);
    codeFrame.itemSpacing = CODE_BLOCK_GAP;
    codeFrame.fills = [makeSolidPaint(tokens.roles.codeBackground.value, tokens.roles.codeBackground.variable)];
    container.appendChild(codeFrame);
    codeFrame.layoutSizingHorizontal = 'FILL';
    appendStyledText(codeFrame, block.value, 'body', fonts, tokens, { name: 'Code', font: fonts.mono, fontSize: CODE_BLOCK_FONT_SIZE });
    return;
  }

  if (block.type === 'bulletList' || block.type === 'numberedList') {
    const items = block.items.map((item) => inlineText(item));
    const characters = items.map((item) => item.text).join('\n');
    const text = appendStyledText(container, characters, 'body', fonts, tokens, { name: block.type === 'bulletList' ? 'Bullet list' : 'Numbered list' });
    if (characters.length > 0) {
      text.setRangeListOptions(0, characters.length, { type: block.type === 'bulletList' ? 'UNORDERED' : 'ORDERED' });
      let start = 0;
      for (let index = 0; index < items.length; index += 1) {
        applyRuns(text, items[index].runs.map((run) => ({ ...run, start: run.start + start, end: run.end + start })), fonts);
        start += items[index].text.length + (index < items.length - 1 ? 1 : 0);
      }
    }
    return;
  }

  const content = inlineText(block.children);
  const role: HandoverTextRole = block.type === 'heading' ? 'h3' : 'body';
  const text = appendStyledText(container, content.text, role, fonts, tokens, { name: block.type === 'heading' ? 'Markdown heading' : 'Markdown paragraph' });
  applyRuns(text, content.runs, fonts);
};

export const appendMarkdown = (
  container: FrameNode,
  markdown: string,
  fonts: GenerationFonts,
  tokens: HandoverTokenSet,
  fallbackMessage = 'Not documented yet.',
): boolean => {
  const blocks = parseMarkdown(markdown);
  if (blocks.length === 0) {
    const placeholder = appendStyledText(container, fallbackMessage, 'body', fonts, tokens, { name: 'Empty section' });
    placeholder.opacity = 0.55;
    return false;
  }
  blocks.forEach((block) => appendBlock(container, block, fonts, tokens));
  return true;
};

export const appendLinks = (
  container: FrameNode,
  links: ComponentDoc['fields']['links'],
  fonts: GenerationFonts,
  tokens: HandoverTokenSet,
): boolean => {
  if (links.length === 0) return false;
  const text = appendStyledText(container, links.map((link) => link.label || link.url).join('\n'), 'body', fonts, tokens, { name: 'Resources' });
  let start = 0;
  links.forEach((link, index) => {
    const label = link.label || link.url;
    if (link.url) text.setRangeHyperlink(start, start + label.length, { type: 'URL', value: link.url });
    start += label.length + (index < links.length - 1 ? 1 : 0);
  });
  text.setRangeListOptions(0, text.characters.length, { type: 'UNORDERED' });
  return true;
};

export const SECTION_TEXT_SCALE = TEXT_SCALE;
