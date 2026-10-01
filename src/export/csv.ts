import type { ComponentDoc } from '../store/types';

export interface CsvComponentRecord {
  name: string;
  group: string;
  type: 'set' | 'component';
  id: string;
  key: string;
  status: string;
  doc: ComponentDoc | null;
}

const DOC_FIELDS: Array<keyof ComponentDoc['fields']> = [
  'purpose',
  'whenToUse',
  'whenNotToUse',
  'responsive',
  'accessibility',
  'contentGuidance',
  'aiGuidance',
  'behaviourNotes',
  'storybookPath',
  'storybookControls',
];

const escapeCell = (value: unknown): string => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const serializeCsv = (records: CsvComponentRecord[]): string => {
  const headers = [
    'name',
    'group',
    'type',
    'node id',
    'component key',
    'status',
    ...DOC_FIELDS,
    'links',
    'updatedAt',
    'updatedBy',
  ];

  const lines = [headers.map(escapeCell).join(',')];
  for (const record of records) {
    const fields = record.doc?.fields;
    const row = [
      record.name,
      record.group,
      record.type,
      record.id,
      record.key,
      record.status,
      ...DOC_FIELDS.map((key) => fields?.[key] ?? ''),
      fields?.links.map((link) => `${link.label}|${link.url}`).join('; ') ?? '',
      record.doc?.updatedAt ?? '',
      record.doc?.updatedBy ?? '',
    ];
    lines.push(row.map(escapeCell).join(','));
  }

  return lines.join('\r\n');
};
