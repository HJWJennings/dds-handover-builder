export const HANDOVER_OUTPUT_PAGE = 'Handover docs';
export const THEME_MODES = ['F&F', 'Lo-Fi'] as const;
export const GENERATED_DATA_NAMESPACE = 'dds_compdoc';
export const GENERATED_DATA_KEY = 'generatedFor';
export const EMPTY_SECTIONS: 'placeholder' | 'hide' = 'placeholder';

// DDS conventions: pointing the plugin at another library is a one-file change.
export const WEB_COLLECTION_NAME = 'Web';
export const BASE_MODE = 'Tesco';
export const DARK_MODE = 'Tesco dark mode';
/** Theme dark-mode naming rule: "<theme> dark mode". */
export const themeDarkModeName = (theme: string) => `${theme} dark mode`;
/** Synthetic On dark axis name (not a real property; never looked up in definitions). */
export const SYNTHETIC_ON_DARK = 'On dark';
/** Property-name patterns. */
export const ON_DARK_PROPERTY_PATTERN = /(on[ _-]?dark|inverse)/i;
export const STATE_PROPERTY_PATTERN = /^(state|status|interaction|focus(ed)?|hover)$/i;
/** Values that mean "on" for the on-dark axis. */
export const ON_VALUE_PATTERN = /^(yes|true|on|dark|inverse)$/i;
export const PREFERRED_FONT_FAMILY = 'TESCO Modern';
export const FALLBACK_FONT_FAMILY = 'Inter';
export const MONO_FONT_FAMILY = 'Roboto Mono';

export interface HandoverSectionDefinition {
  key: string;
  title: string;
  slots?: Array<{ key: string; phase?: 5 | 6; manual?: boolean }>;
}

export const HANDOVER_SECTIONS: HandoverSectionDefinition[] = [
  { key: 'visual-reference', title: 'Visual reference', slots: [{ phase: 5, key: 'visual-reference' }] },
  { key: 'key-changes', title: 'Key changes' },
  { key: 'when-to-use', title: 'When to use' },
  { key: 'when-not-to-use', title: 'When NOT to use' },
  { key: 'storybook-hierarchy', title: 'Storybook hierarchy' },
  { key: 'responsive', title: 'Responsive' },
  { key: 'variants', title: 'Variants', slots: [
    { phase: 5, key: 'variants' },
    { phase: 5, key: 'on-dark' },
    { phase: 5, key: 'theme' },
  ] },
  { key: 'smaller-theme', title: 'Smaller theme', slots: [{ key: 'dds-vs-eds', manual: true }] },
  { key: 'design-tokens', title: 'Design tokens', slots: [{ phase: 6, key: 'design-tokens' }] },
  { key: 'configuration-behaviour', title: 'Configuration and behaviour', slots: [{ phase: 6, key: 'configuration' }] },
  { key: 'structure-breakdown', title: 'Structure breakdown', slots: [{ phase: 5, key: 'anatomy' }] },
  { key: 'interactive-flows', title: 'Interactive flows, animation and transitions', slots: [{ phase: 6, key: 'interactions' }] },
  { key: 'content-guidance', title: 'Content guidance' },
  { key: 'accessibility', title: 'Accessibility' },
  { key: 'ai-guidance', title: 'AI guidance' },
];

export type HandoverTokenRole =
  | 'textOnDark'
  | 'textBody'
  | 'textPrimary'
  | 'pageBackground'
  | 'divider'
  | 'bandFill'
  | 'heading'
  | 'codeBackground';

export interface TokenRoleDefinition {
  role: HandoverTokenRole;
  candidates?: string[];
  collectionPathPrefix?: string;
  matchTescoHex?: string;
  fallback: string;
  verify?: boolean;
}

export const TOKEN_ROLE_DEFINITIONS: TokenRoleDefinition[] = [
  { role: 'textOnDark', candidates: ['Typography/colour-text-on-dark'], fallback: '#FFFFFF' },
  { role: 'textBody', candidates: ['Typography/colour-text-body'], fallback: '#666666' },
  { role: 'textPrimary', candidates: ['Typography/colour-text-header-primary'], fallback: '#333333' },
  { role: 'pageBackground', candidates: ['Background/colour-background-1'], fallback: '#FFFFFF' },
  { role: 'divider', candidates: ['Line/colour-border-primary'], fallback: '#CCCCCC' },
  { role: 'bandFill', candidates: ['Background/colour-background-dark-primary'], collectionPathPrefix: 'Background/', matchTescoHex: '#00539F', fallback: '#00539F' },
  { role: 'heading', candidates: ['Typography/colour-text-header-secondary'], collectionPathPrefix: 'Typography/', matchTescoHex: '#00539F', fallback: '#00539F' },
  { role: 'codeBackground', candidates: ['Background/colour-background-2'], collectionPathPrefix: 'Background/', matchTescoHex: '#F6F6F6', fallback: '#F6F6F6' },
];

