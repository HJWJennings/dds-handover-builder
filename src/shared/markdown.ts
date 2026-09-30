// Pure markdown-subset parser: no DOM dependencies, so it can run in the plugin sandbox,
// the UI iframe (for the Preview toggle), and Phase 4 (writing styled Figma text).

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'strikethrough'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: 'heading'; level: 1; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'bulletList'; items: InlineNode[][] }
  | { type: 'numberedList'; items: InlineNode[][] }
  | { type: 'codeBlock'; value: string };

const INLINE_PATTERN =
  /(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/;

export const parseInline = (text: string): InlineNode[] => {
  const nodes: InlineNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const match = INLINE_PATTERN.exec(remaining);
    if (!match || match.index === undefined) {
      nodes.push({ type: 'text', value: remaining });
      break;
    }

    if (match.index > 0) {
      nodes.push({ type: 'text', value: remaining.slice(0, match.index) });
    }

    if (match[1]) {
      nodes.push({ type: 'bold', children: parseInline(match[2]) });
    } else if (match[3]) {
      nodes.push({ type: 'strikethrough', children: parseInline(match[4]) });
    } else if (match[5]) {
      nodes.push({ type: 'italic', children: parseInline(match[6]) });
    } else if (match[7]) {
      nodes.push({ type: 'code', value: match[8] });
    } else if (match[9]) {
      nodes.push({ type: 'link', href: match[11], children: parseInline(match[10]) });
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return nodes;
};

export const parseMarkdown = (source: string): BlockNode[] => {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  const isBulletLine = (line: string) => /^[-*]\s+/.test(line);
  const isNumberedLine = (line: string) => /^\d+\.\s+/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence
      blocks.push({ type: 'codeBlock', value: codeLines.join('\n') });
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push({ type: 'heading', level: 1, children: parseInline(line.slice(2)) });
      i += 1;
      continue;
    }

    if (isBulletLine(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && isBulletLine(lines[i])) {
        items.push(parseInline(lines[i].replace(/^[-*]\s+/, '')));
        i += 1;
      }
      blocks.push({ type: 'bulletList', items });
      continue;
    }

    if (isNumberedLine(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && isNumberedLine(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\d+\.\s+/, '')));
        i += 1;
      }
      blocks.push({ type: 'numberedList', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim().length > 0 &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('# ') &&
      !isBulletLine(lines[i]) &&
      !isNumberedLine(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraphLines.join(' ')) });
  }

  return blocks;
};

// ---------------------------------------------------------------------------
// Toolbar helpers: pure string transforms operating on a textarea's value/selection.
// ---------------------------------------------------------------------------

export type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'h1'
  | 'bulletList'
  | 'numberedList'
  | 'link'
  | 'code'
  | 'codeBlock';

export interface TextSelection {
  value: string;
  start: number;
  end: number;
}

export const applyMarkdownAction = (action: MarkdownAction, selection: TextSelection): TextSelection => {
  const { value, start, end } = selection;
  const selected = value.slice(start, end);

  const wrap = (marker: string, placeholder: string): TextSelection => {
    const inner = selected || placeholder;
    const next = `${value.slice(0, start)}${marker}${inner}${marker}${value.slice(end)}`;
    return { value: next, start: start + marker.length, end: start + marker.length + inner.length };
  };

  const prefixLines = (prefixFor: (index: number) => string, placeholder: string): TextSelection => {
    const inner = selected || placeholder;
    const prefixed = inner
      .split('\n')
      .map((line, index) => `${prefixFor(index)}${line}`)
      .join('\n');
    const next = `${value.slice(0, start)}${prefixed}${value.slice(end)}`;
    return { value: next, start, end: start + prefixed.length };
  };

  switch (action) {
    case 'bold':
      return wrap('**', 'bold text');
    case 'italic':
      return wrap('_', 'italic text');
    case 'strikethrough':
      return wrap('~~', 'strikethrough text');
    case 'code':
      return wrap('`', 'code');
    case 'h1':
      return prefixLines(() => '# ', 'Heading');
    case 'bulletList':
      return prefixLines(() => '- ', 'List item');
    case 'numberedList':
      return prefixLines((index) => `${index + 1}. `, 'List item');
    case 'link': {
      const label = selected || 'link text';
      const insertion = `[${label}](https://)`;
      const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
      const urlStart = start + label.length + 3; // "[" + label + "](" 
      return { value: next, start: urlStart, end: urlStart + 'https://'.length };
    }
    case 'codeBlock': {
      const inner = selected || 'code';
      const insertion = `\`\`\`\n${inner}\n\`\`\``;
      const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
      return { value: next, start: start + 4, end: start + 4 + inner.length };
    }
    default:
      return selection;
  }
};
