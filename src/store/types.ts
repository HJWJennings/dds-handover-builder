export const PLUGIN_DATA_NAMESPACE = 'dds_compdoc';
export const PLUGIN_DATA_DOC_KEY = 'doc';

export interface ComponentDocLink {
  label: string;
  url: string;
}

export interface ComponentDoc {
  schemaVersion: 1;
  updatedAt: string;
  updatedBy?: string;
  status: 'draft' | 'ready';
  fields: {
    purpose: string;
    whenToUse: string;
    whenNotToUse: string;
    responsive: string;
    accessibility: string;
    contentGuidance: string;
    aiGuidance: string;
    behaviourNotes: string;
    storybookPath: string;
    storybookControls: string;
    links: ComponentDocLink[];
  };
  handover?: { frameId: string; generatedAt: string };
  handoverConfig?: {
    /** Per VARIANT property: force it onto the columns or rows axis, or let the generator decide. */
    axes?: Record<string, 'auto' | 'columns' | 'rows'>;
    /** Friendly labels keyed by "<Property>=<Value>" using raw property names. */
    labels?: Record<string, string>;
    /** Per VARIANT property: reverse the option order on its axis. */
    reverse?: Record<string, boolean>;
    onDark?: 'auto' | 'off';
    themes?: 'auto' | 'off';
  };
  /** Whether Save also mirrors a condensed summary into the node's description. */
  syncToDescription?: boolean;
}

export const REQUIRED_FIELDS: Array<keyof ComponentDoc['fields']> = [
  'purpose',
  'whenToUse',
  'whenNotToUse',
  'accessibility',
];
