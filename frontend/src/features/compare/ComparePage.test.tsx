/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ComparePage from './ComparePage';
import { documentsApi, compareApi } from '@/lib/api/endpoints';

// Mock endpoints
vi.mock('@/lib/api/endpoints', () => ({
  documentsApi: {
    list: vi.fn(),
  },
  compareApi: {
    list: vi.fn(),
    compare: vi.fn(),
  },
}));

const mockDocs = [
  {
    id: 'doc-csv-1',
    original_filename: 'Book(Sheet1).csv',
    filename: 'hash_Book(Sheet1).csv',
    file_type: 'csv',
    file_size: 15000,
    created_at: new Date().toISOString(),
    status: 'indexed',
  },
  {
    id: 'doc-pdf-2',
    original_filename: 'rag(pdf).pdf',
    filename: 'hash_rag(pdf).pdf',
    file_type: 'pdf',
    file_size: 475000,
    created_at: new Date().toISOString(),
    status: 'indexed',
  },
  {
    id: 'doc-xlsx-3',
    original_filename: 'Ecommerce 1.xlsx',
    filename: 'hash_Ecommerce 1.xlsx',
    file_type: 'xlsx',
    file_size: 25000,
    created_at: new Date().toISOString(),
    status: 'indexed',
  },
];

const mockCsvPdfResult = {
  id: 'comp-1',
  comparison_id: 'comp-1',
  document_a_id: 'doc-csv-1',
  document_a_filename: 'Book(Sheet1).csv',
  document_b_id: 'doc-pdf-2',
  document_b_filename: 'rag(pdf).pdf',
  document_a: mockDocs[0],
  document_b: mockDocs[1],
  comparison_mode: 'cross_modal_incompatible',
  comparison_status: 'incompatible',
  summary: 'Incompatible formats: CSV customer table vs ISO/IEC 27001 narrative PDF.',
  status: 'incompatible',
  added_count: 0,
  removed_count: 0,
  modified_count: 1,
  detailed_changes: [
    {
      type: 'modified' as const,
      category: 'format',
      location_a: 'Book(Sheet1).csv',
      location_b: 'rag(pdf).pdf',
      content_a: 'CSV',
      content_b: 'PDF',
      description: 'Format mismatch between CSV and PDF.',
    },
  ],
  differences: [
    {
      type: 'modified' as const,
      category: 'format',
      location_a: 'Book(Sheet1).csv',
      location_b: 'rag(pdf).pdf',
      content_a: 'CSV',
      content_b: 'PDF',
      description: 'Format mismatch between CSV and PDF.',
    },
  ],
  created_at: new Date().toISOString(),
};

const mockCsvXlsxResult = {
  id: 'comp-2',
  comparison_id: 'comp-2',
  document_a_id: 'doc-csv-1',
  document_a_filename: 'Book(Sheet1).csv',
  document_b_id: 'doc-xlsx-3',
  document_b_filename: 'Ecommerce 1.xlsx',
  document_a: mockDocs[0],
  document_b: mockDocs[2],
  comparison_mode: 'structural_entity',
  comparison_status: 'completed',
  summary: 'Direct row-by-row comparison is not appropriate because the documents contain different entity structures.',
  status: 'completed',
  added_count: 0,
  removed_count: 0,
  modified_count: 4,
  detailed_changes: [
    {
      type: 'modified' as const,
      category: 'entity_scope',
      location_a: 'Book(Sheet1).csv (Single Table)',
      location_b: 'Ecommerce 1.xlsx (3 Sheets)',
      content_a: 'Customers',
      content_b: 'Customers, Products, Orders',
      description: 'Multi-entity scope mismatch between single CSV table and 3-sheet workbook.',
    },
  ],
  differences: [
    {
      type: 'modified' as const,
      category: 'entity_scope',
      location_a: 'Book(Sheet1).csv (Single Table)',
      location_b: 'Ecommerce 1.xlsx (3 Sheets)',
      content_a: 'Customers',
      content_b: 'Customers, Products, Orders',
      description: 'Multi-entity scope mismatch between single CSV table and 3-sheet workbook.',
    },
  ],
  created_at: new Date().toISOString(),
};

describe('ComparePage Component Regression Tests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(documentsApi.list).mockResolvedValue({
      documents: mockDocs,
      total: 3,
      page: 1,
      page_size: 100,
    } as any);
    vi.mocked(compareApi.list).mockResolvedValue([mockCsvPdfResult] as any);
    vi.mocked(compareApi.compare).mockImplementation(async (aId, bId) => {
      if (aId === 'doc-csv-1' && bId === 'doc-pdf-2') return mockCsvPdfResult as any;
      if (aId === 'doc-csv-1' && bId === 'doc-xlsx-3') return mockCsvXlsxResult as any;
      throw new Error('Comparison not found');
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/compare']}>
          <Routes>
            <Route path="/compare" element={<ComparePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it('immediately clears old results when dropdown selection changes', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText(/Book\(Sheet1\)\.csv/).length).toBeGreaterThan(0);
    });

    const selects = screen.getAllByRole('combobox');
    const selectA = selects[0];
    const selectB = selects[1];

    // Select CSV A and PDF B
    fireEvent.change(selectA, { target: { value: 'doc-csv-1' } });
    fireEvent.change(selectB, { target: { value: 'doc-pdf-2' } });

    // Compare
    const compareBtn = screen.getByRole('button', { name: /Compare Documents/i });
    fireEvent.click(compareBtn);

    // Verify CSV vs PDF comparison appears in active analysis view
    await waitFor(() => {
      expect(screen.getByText('Comparison Analysis')).toBeDefined();
      expect(screen.getByText('Executive Summary:')).toBeDefined();
      expect(screen.getByText('Format mismatch between CSV and PDF.')).toBeDefined();
    });

    // Now change dropdown B to Excel C
    fireEvent.change(selectB, { target: { value: 'doc-xlsx-3' } });

    // Old active comparison results must disappear immediately
    expect(screen.queryByText('Comparison Analysis')).toBeNull();
    expect(screen.queryByText('Executive Summary:')).toBeNull();
    expect(screen.queryByText('Format mismatch between CSV and PDF.')).toBeNull();

    // Ready to compare prompt is shown
    expect(screen.getByText(/Ready to Compare/i)).toBeDefined();
  });

  it('sends correct document IDs and renders verified response for CSV vs Excel', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText(/Book\(Sheet1\)\.csv/).length).toBeGreaterThan(0);
    });

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'doc-csv-1' } });
    fireEvent.change(selects[1], { target: { value: 'doc-xlsx-3' } });

    const compareBtn = screen.getByRole('button', { name: /Compare Documents/i });
    fireEvent.click(compareBtn);

    // Check compare API was called with exact IDs
    await waitFor(() => {
      expect(compareApi.compare).toHaveBeenCalledWith('doc-csv-1', 'doc-xlsx-3');
    });

    // Check verified response appears
    await waitFor(() => {
      expect(screen.getByText(/Direct row-by-row comparison is not appropriate/i)).toBeDefined();
      expect(screen.getByText(/Structural & Entity Analysis/i)).toBeDefined();
    });

    // Filenames in header belong strictly to the verified response
    expect(screen.getAllByText(/Book\(Sheet1\)\.csv/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ecommerce 1\.xlsx/i).length).toBeGreaterThan(0);

    // rag(pdf).pdf should only appear in Past Comparisons, never in the Comparison Analysis header
    const analysisHeader = screen.getByText(/Comparison Analysis/i).closest('div');
    expect(analysisHeader?.textContent).not.toContain('rag(pdf).pdf');
  });

  it('synchronizes dropdowns when a past comparison is clicked from history', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Past Comparisons/i)).toBeDefined();
    });

    // Click on past comparison in history (CSV vs PDF)
    const historyItem = screen.getByText(/Incompatible formats: CSV customer table/i);
    fireEvent.click(historyItem);

    // Both dropdowns must update to match the historical item
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0].value).toBe('doc-csv-1');
    expect(selects[1].value).toBe('doc-pdf-2');

    // And the comparison is shown
    expect(screen.getByText(/Incompatible formats: CSV customer table/i)).toBeDefined();
  });

  it('displays error state and clears stale results on comparison failure', async () => {
    vi.mocked(compareApi.compare).mockRejectedValueOnce(new Error('Network timeout during comparison'));

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText(/Book\(Sheet1\)\.csv/).length).toBeGreaterThan(0);
    });

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'doc-csv-1' } });
    fireEvent.change(selects[1], { target: { value: 'doc-xlsx-3' } });

    const compareBtn = screen.getByRole('button', { name: /Compare Documents/i });
    fireEvent.click(compareBtn);

    await waitFor(() => {
      expect(screen.getByText(/Comparison Failed/i)).toBeDefined();
      expect(screen.getByText(/Network timeout during comparison/i)).toBeDefined();
    });

    // No stale comparison active view is displayed
    expect(screen.queryByText('Comparison Analysis')).toBeNull();
    expect(screen.queryByText('Executive Summary:')).toBeNull();
  });
});
