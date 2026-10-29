/**
 * Knowledge AI — Constants
 */

export const API_BASE = '/api';

export const FILE_TYPES = {
  pdf: { label: 'PDF', color: 'hsl(0 72% 55%)' },
  docx: { label: 'DOCX', color: 'hsl(210 70% 56%)' },
  txt: { label: 'TXT', color: 'hsl(35 6% 58%)' },
  csv: { label: 'CSV', color: 'hsl(152 55% 42%)' },
  xlsx: { label: 'XLSX', color: 'hsl(152 55% 42%)' },
} as const;

export const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt', 'csv', 'xlsx'] as const;
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const ACCEPTED_MIME_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

export const DEBOUNCE_MS = 250;
export const SSE_RETRY_MS = 3000;
