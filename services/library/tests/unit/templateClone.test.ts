import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../src/db', () => ({
  getPool: () => ({
    query: mockQuery,
  }),
}));

import * as templateService from '../../src/services/templateService';

describe('templateService — cloneTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clones a template and its slots, mapping categories by code', async () => {
    const sourceTemplateId = 'tmpl-src';
    const targetStationId = 'station-target';

    // 1. Mock getTemplate - first call: template metadata
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: sourceTemplateId,
        station_id: 'station-src',
        name: 'Source Template',
        type: '1_day',
        is_default: true,
      }],
    });
    // 2. Mock getTemplate - second call: slots
    mockQuery.mockResolvedValueOnce({
      rows: [
        { template_id: sourceTemplateId, hour: 10, position: 0, required_category_id: 'cat-src-id' },
      ],
    });

    // 3. Fetch categories for source
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'cat-src-id', code: 'A' }],
    });
    // 4. Fetch categories for target
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'cat-target-id', code: 'A' }],
    });

    // 5. Create new template (insert)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'tmpl-new', name: 'Source Template (Copy)', type: '1_day' }],
    });

    // 6. setTemplateSlots - DELETE current slots
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    
    // 7. setTemplateSlots - INSERT new slots
    mockQuery.mockResolvedValueOnce({
      rows: [{ template_id: 'tmpl-new', hour: 10, position: 0, required_category_id: 'cat-target-id' }],
    });

    // 8. Final getTemplate for return - metadata
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'tmpl-new', name: 'Source Template (Copy)', type: '1_day' }],
    });
    // 9. Final getTemplate for return - slots
    mockQuery.mockResolvedValueOnce({
      rows: [{ template_id: 'tmpl-new', hour: 10, position: 0, required_category_id: 'cat-target-id' }],
    });

    const result = await templateService.cloneTemplate(sourceTemplateId, targetStationId);

    expect(result.id).toBe('tmpl-new');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO templates'),
      expect.arrayContaining([targetStationId, 'Source Template (Copy)'])
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO template_slots'),
      expect.arrayContaining(['tmpl-new', 10, 0, 'cat-target-id'])
    );
  });
});
