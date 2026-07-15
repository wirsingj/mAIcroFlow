import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendFishingCsvRow, appendMacroCsvRow, buildFishingCsvGrid, buildMacroCsvGrid, formatWorkbookWriteFailure, renderMacroClipboardText } from '../src/main/services/actions';
import { appendFishingWorkbookRow, appendMacroWorkbookRow } from '../src/main/services/actions';
import type { CsvFishingRow, MacroOutputRow } from '../src/shared/types';

const baseRow: CsvFishingRow = {
  timestamp: '2026-05-11T12:00:00Z',
  workflow_name: 'Fishing Logger Demo',
  fish_name: 'Blue-striped Grouper',
  exp_gained: '19',
  weight: '847 g',
  class_tier: 'B',
  bait_used: '',
  confidence: 0.95,
  screenshot_path: 'capture.png',
  notes: ''
};

describe('CSV append and summary block', () => {
  it('writes generic macro fields without fishing-shaped columns', async () => {
    const path = join(await import('node:os').then((os) => os.tmpdir()), `maicroflow-generic-${Date.now()}.csv`);
    const row: MacroOutputRow = {
      timestamp: '2026-05-11T12:00:00Z',
      workflow_name: 'Number Scanner',
      confidence: 0.9,
      notes: '',
      fields: {
        age: 42,
        weight: '180 lb',
        timestamp_value: '12:30'
      }
    };

    await appendMacroCsvRow(row, path);
    const content = await readFile(path, 'utf8');

    expect(content).toContain('timestamp,workflow_name,age,weight,timestamp_value,confidence,notes');
    expect(content).toContain('Number Scanner,42,180 lb,12:30,0.9');
    expect(content).toContain('summary_metric,summary_value');
    expect(content).not.toContain('fish_name');
    expect(content).not.toContain('exp_gained');
  });

  it('renders reviewed structured fields for clipboard output without fishing-shaped columns', () => {
    const text = renderMacroClipboardText({
      timestamp: '2026-05-11T12:00:00Z',
      workflow_name: 'Number Scanner',
      confidence: 0.91,
      notes: 'checked by user',
      fields: {
        age: 42,
        status: 'ready'
      }
    });

    expect(text).toContain('workflow: Number Scanner');
    expect(text).toContain('age: 42');
    expect(text).toContain('status: ready');
    expect(text).toContain('confidence: 91%');
    expect(text).toContain('notes: checked by user');
    expect(text).not.toContain('fish_name');
    expect(text).not.toContain('exp_gained');
  });

  it('updates generic summary metrics for repeated rows', () => {
    const grid = buildMacroCsvGrid([
      {
        timestamp: '2026-05-11T12:00:00Z',
        workflow_name: 'Score Macro',
        confidence: 0.9,
        notes: '',
        fields: { score: 10, label: 'first' }
      },
      {
        timestamp: '2026-05-11T12:01:00Z',
        workflow_name: 'Score Macro',
        confidence: 0.8,
        notes: '',
        fields: { score: 20, label: 'second' }
      }
    ]);

    const flat = grid.map((row) => row.join(',')).join('\n');
    expect(flat).toContain('total_rows,2');
    expect(flat).toContain('filled.score,2');
    expect(flat).toContain('avg.score,15.00');
  });

  it('writes a generic Excel workbook with raw data and summary sheets', async () => {
    const path = join(await import('node:os').then((os) => os.tmpdir()), `maicroflow-generic-${Date.now()}.xlsx`);

    await appendMacroWorkbookRow(
      {
        timestamp: '2026-05-11T12:00:00Z',
        workflow_name: 'Generic Macro',
        confidence: 0.9,
        notes: '',
        fields: { amount: 100, label: 'first' }
      },
      path
    );

    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.readFile(path);

    expect(workbook.getWorksheet('Raw Data')?.getCell('C1').value).toBe('amount');
    expect(workbook.getWorksheet('Raw Data')?.getCell('C2').value).toBe('100');
    expect(workbook.getWorksheet('Summary')?.getCell('A2').value).toBe('total_rows');
  });

  it('repeated F12-style appends create multiple raw rows and update summary', async () => {
    const path = join(await import('node:os').then((os) => os.tmpdir()), `maicroflow-${Date.now()}.csv`);

    await appendFishingCsvRow(baseRow, path);
    await appendFishingCsvRow({ ...baseRow, fish_name: 'Ruby Carp', exp_gained: '21', weight: '900 g', class_tier: 'A' }, path);

    const content = await readFile(path, 'utf8');
    expect(content).toContain('Blue-striped Grouper');
    expect(content).toContain('Ruby Carp');
    expect(content).toContain('total_catches,2');
    expect(content).toContain('avg_exp,20.00');
    expect(content).toContain('class_tier_counts.B,1');
    expect(content).toContain('class_tier_counts.A,1');
    expect(content).not.toContain('Create a stats block.');
  });

  it('summary block updates correctly after multiple rows', () => {
    const grid = buildFishingCsvGrid([
      baseRow,
      { ...baseRow, fish_name: 'Ruby Carp', exp_gained: '21', weight: '900 g', class_tier: 'A' }
    ]);

    const flat = grid.map((row) => row.join(',')).join('\n');
    expect(flat).toContain('summary_metric,summary_value');
    expect(flat).toContain('best_exp_fish,Ruby Carp (21)');
    expect(flat).toContain('avg_weight,873.50');
  });

  it('writes a readable Excel workbook with raw data and summary sheets', async () => {
    const path = join(await import('node:os').then((os) => os.tmpdir()), `maicroflow-${Date.now()}.xlsx`);

    await appendFishingWorkbookRow(baseRow, path);
    await appendFishingWorkbookRow({ ...baseRow, fish_name: 'Ruby Carp', exp_gained: '21', weight: '900 g', class_tier: 'A' }, path);

    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.readFile(path);

    expect(workbook.getWorksheet('Raw Data')?.getCell('C2').value).toBe('Blue-striped Grouper');
    expect(workbook.getWorksheet('Raw Data')?.getCell('C3').value).toBe('Ruby Carp');
    expect(workbook.getWorksheet('Summary')?.getCell('A2').value).toBe('total_catches');
    expect(workbook.getWorksheet('Summary')?.getCell('B2').value).toBe('2');
  });

  it('explains locked workbook write failures with a recovery path', () => {
    const message = formatWorkbookWriteFailure('C:\\Users\\wirsi\\Documents\\mAIcroFlow\\output\\stats.xlsx', {
      code: 'EBUSY',
      message: 'resource busy or locked'
    });

    expect(message).toContain('open or locked');
    expect(message).toContain('Close it in Excel');
    expect(message).toContain('switch this action to CSV');
  });

  it('keeps the underlying reason for non-lock workbook failures', () => {
    const message = formatWorkbookWriteFailure('C:\\Users\\wirsi\\Documents\\mAIcroFlow\\output\\stats.xlsx', new Error('disk full'));

    expect(message).toContain('Could not update workbook');
    expect(message).toContain('disk full');
  });
});
