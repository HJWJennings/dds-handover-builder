export interface GenerationFonts {
  body: FontName;
  bold: FontName;
  italic: FontName | null;
  mono: FontName;
  report: {
    bodyFamily: string;
    bodyFallback: string | null;
    regularStyle: string;
    boldStyle: string;
    italicStyle: string | null;
    monoFamily: string;
    monoStyle: string;
    monoFallback: string | null;
    fallbacks: string[];
    errors: string[];
  };
}

const findStyle = (fonts: Font[], family: string, match: (style: string) => boolean): Font | null =>
  fonts.find((font) => font.fontName.family.toLowerCase() === family.toLowerCase() && match(font.fontName.style)) ?? null;

const loadFont = async (font: Font): Promise<FontName> => {
  await figma.loadFontAsync(font.fontName);
  return font.fontName;
};

export const loadGenerationFonts = async (): Promise<GenerationFonts> => {
  const report: GenerationFonts['report'] = {
    bodyFamily: '',
    bodyFallback: null,
    regularStyle: '',
    boldStyle: '',
    italicStyle: null,
    monoFamily: '',
    monoStyle: '',
    monoFallback: null,
    fallbacks: [],
    errors: [],
  };

  const available = await figma.listAvailableFontsAsync();
  const preferredFamily = 'TESCO Modern';
  const preferredStyles = available
    .filter((font) => font.fontName.family === preferredFamily)
    .map((font) => font.fontName.style);
  console.log('[generate] TESCO Modern available styles', preferredStyles);
  let bodyFamily = preferredFamily;
  let regular = findStyle(available, bodyFamily, (style) => style.toLowerCase() === 'regular');
  let bold = findStyle(available, bodyFamily, (style) => style.toLowerCase() === 'bold');

  if (!regular || !bold) {
    bodyFamily = 'Inter';
    regular = findStyle(available, bodyFamily, (style) => style.toLowerCase() === 'regular') ?? findStyle(available, bodyFamily, () => true);
    bold = findStyle(available, bodyFamily, (style) => style.toLowerCase() === 'bold');
    report.bodyFallback = `${preferredFamily} unavailable; using Inter.`;
    report.fallbacks.push(report.bodyFallback);
  }

  if (!regular || !bold) {
    throw new Error('Neither Tesco Modern nor Inter provides loadable regular and bold styles.');
  }

  let body: FontName;
  let bodyBold: FontName;
  try {
    body = await loadFont(regular);
    bodyBold = await loadFont(bold);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.errors.push(`Failed to load ${bodyFamily} fonts: ${message}`);
    if (bodyFamily.toLowerCase() === 'inter') throw error;
    bodyFamily = 'Inter';
    regular = findStyle(available, bodyFamily, (style) => style.toLowerCase() === 'regular') ?? findStyle(available, bodyFamily, () => true);
    bold = findStyle(available, bodyFamily, (style) => style.toLowerCase() === 'bold');
    if (!regular || !bold) throw error;
    body = await loadFont(regular);
    bodyBold = await loadFont(bold);
    report.bodyFallback = `${preferredFamily} could not be loaded; using Inter.`;
    report.fallbacks.push(report.bodyFallback);
  }

  const italicFont = findStyle(available, bodyFamily, (style) => style.toLowerCase() === 'italic')
    ?? findStyle(available, bodyFamily, (style) => style.toLowerCase() === 'regular italic');
  let italic: FontName | null = null;
  if (italicFont) {
    try {
      italic = await loadFont(italicFont);
    } catch (error) {
      report.errors.push(`Failed to load italic style ${italicFont.fontName.family} ${italicFont.fontName.style}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const monoFont = findStyle(available, 'Roboto Mono', (style) => style.toLowerCase() === 'regular')
    ?? findStyle(available, 'Roboto Mono', () => true);
  let mono: FontName;
  if (monoFont) {
    try {
      mono = await loadFont(monoFont);
    } catch (error) {
      mono = body;
      report.monoFallback = `Roboto Mono could not be loaded; using ${body.family}.`;
      report.fallbacks.push(report.monoFallback);
      report.errors.push(`Failed to load Roboto Mono: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    mono = body;
    report.monoFallback = `Roboto Mono unavailable; using ${body.family}.`;
    report.fallbacks.push(report.monoFallback);
  }

  report.bodyFamily = body.family;
  report.regularStyle = body.style;
  report.boldStyle = bodyBold.style;
  report.italicStyle = italic?.style ?? null;
  report.monoFamily = mono.family;
  report.monoStyle = mono.style;
  return { body, bold: bodyBold, italic, mono, report };
};
