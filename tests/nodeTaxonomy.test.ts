import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../src/shared/types';
import { categoryForNodeType, describeNodeCategory, normalizeNodeCategory } from '../src/shared/nodeTaxonomy';

describe('workflow node taxonomy', () => {
  it('maps v0 execution node types into the product taxonomy', () => {
    expect(categoryForNodeType('trigger')).toBe('trigger');
    expect(categoryForNodeType('capture')).toBe('observe');
    expect(categoryForNodeType('extract')).toBe('think');
    expect(categoryForNodeType('validate')).toBe('guard');
    expect(categoryForNodeType('review')).toBe('guard');
    expect(categoryForNodeType('action')).toBe('act');
  });

  it('normalizes nodes without changing their execution type', () => {
    const node: WorkflowNode = {
      id: 'extract-values',
      type: 'extract',
      title: 'Extract Values',
      summary: 'Read visible values',
      config: {}
    };

    const normalized = normalizeNodeCategory(node);

    expect(normalized.type).toBe('extract');
    expect(normalized.category).toBe('think');
    expect(describeNodeCategory(normalized).intent).toContain('local AI');
  });
});
