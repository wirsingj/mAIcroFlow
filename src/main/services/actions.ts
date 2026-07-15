import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import ExcelJS from 'exceljs';
import type { CsvFishingRow, MacroOutputRow, StructuredFieldValue } from '../../shared/types';
import { dataPath } from './paths';
import { parseNumberText } from './validation';

export const fishingCsvColumns: Array<keyof CsvFishingRow> = [
  'timestamp',
  'workflow_name',
  'fish_name',
  'exp_gained',
  'weight',
  'class_tier',
  'bait_used',
  'confidence',
  'screenshot_path',
  'notes'
];

type CsvGrid = string[][];

const macroFixedColumns = ['timestamp', 'workflow_name'] as const;
const macroTrailingColumns = ['confidence', 'notes'] as const;

export async function appendMacroCsvRow(row: MacroOutputRow, csvPath: string): Promise<void> {
  await mkdir(dirname(csvPath), { recursive: true });
  const existingRows = await readRawMacroRows(csvPath);
  existingRows.push(row);
  await writeFile(csvPath, serializeCsv(buildMacroCsvGrid(existingRows)), 'utf8');
}

export async function appendMacroWorkbookRow(row: MacroOutputRow, workbookPath: string): Promise<void> {
  await mkdir(dirname(workbookPath), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  let existingRows: MacroOutputRow[] = [];

  try {
    await workbook.xlsx.readFile(workbookPath);
    const rawSheet = workbook.getWorksheet('Raw Data');
    if (rawSheet) {
      existingRows = readMacroRowsFromWorksheet(rawSheet);
    }
  } catch {
    // Missing or unreadable workbook starts fresh.
  }

  existingRows.push(row);
  workbook.removeWorksheet(workbook.getWorksheet('Raw Data')?.id ?? -1);
  workbook.removeWorksheet(workbook.getWorksheet('Summary')?.id ?? -1);
  writeMacroRawDataSheet(workbook, existingRows);
  writeMacroSummarySheet(workbook, existingRows);
  try {
    await workbook.xlsx.writeFile(workbookPath);
  } catch (error) {
    throw workbookWriteFailure(workbookPath, error);
  }
}

export function renderMacroClipboardText(row: MacroOutputRow): string {
  const lines = [
    `workflow: ${row.workflow_name}`,
    `timestamp: ${row.timestamp}`,
    ...Object.entries(row.fields).map(([field, value]) => `${field}: ${String(value ?? '')}`),
    `confidence: ${Math.round((row.confidence ?? 0) * 100)}%`
  ];
  const notes = String(row.notes ?? '').trim();
  if (notes) {
    lines.push(`notes: ${notes}`);
  }
  return lines.join('\n');
}

export function buildMacroCsvGrid(rows: MacroOutputRow[]): CsvGrid {
  const fieldColumns = macroFieldColumns(rows);
  const columns = [...macroFixedColumns, ...fieldColumns, ...macroTrailingColumns];
  const summaryStart = columns.length + 2;
  const summaryRows = buildMacroSummaryRows(rows, fieldColumns);
  const height = Math.max(rows.length + 1, summaryRows.length);
  const width = summaryStart + 3;
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ''));

  columns.forEach((column, index) => {
    grid[0][index] = column;
  });
  rows.forEach((row, rowIndex) => {
    const values = macroRowValues(row, fieldColumns);
    values.forEach((value, columnIndex) => {
      grid[rowIndex + 1][columnIndex] = value;
    });
  });
  summaryRows.forEach((summaryRow, rowIndex) => {
    grid[rowIndex][summaryStart] = summaryRow[0];
    grid[rowIndex][summaryStart + 1] = summaryRow[1];
    grid[rowIndex][summaryStart + 2] = summaryRow[2] ?? '';
  });

  return grid.map(trimTrailingEmptyCells);
}

export async function appendFishingCsvRow(
  row: CsvFishingRow,
  csvPath = dataPath('fishing_log.csv')
): Promise<void> {
  await mkdir(dirname(csvPath), { recursive: true });
  const rawRows = await readRawFishingRows(csvPath);
  rawRows.push(row);
  const grid = buildFishingCsvGrid(rawRows);
  await writeFile(csvPath, serializeCsv(grid), 'utf8');
}

export async function appendFishingWorkbookRow(row: CsvFishingRow, workbookPath: string): Promise<void> {
  await mkdir(dirname(workbookPath), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  let existingRows: CsvFishingRow[] = [];

  try {
    await workbook.xlsx.readFile(workbookPath);
    const rawSheet = workbook.getWorksheet('Raw Data');
    if (rawSheet) {
      existingRows = readRowsFromWorksheet(rawSheet);
    }
  } catch {
    // Missing or unreadable workbook starts fresh.
  }

  existingRows.push(row);
  workbook.removeWorksheet(workbook.getWorksheet('Raw Data')?.id ?? -1);
  workbook.removeWorksheet(workbook.getWorksheet('Summary')?.id ?? -1);
  writeRawDataSheet(workbook, existingRows);
  writeSummarySheet(workbook, existingRows);
  try {
    await workbook.xlsx.writeFile(workbookPath);
  } catch (error) {
    throw workbookWriteFailure(workbookPath, error);
  }
}

export function formatWorkbookWriteFailure(workbookPath: string, error: unknown): string {
  const code = errorCode(error);
  const reason = error instanceof Error && error.message ? error.message : String(error);
  if (code && ['EBUSY', 'EACCES', 'EPERM'].includes(code)) {
    return `Could not update workbook because it appears to be open or locked: ${workbookPath}. Close it in Excel, then run the workflow again, or switch this action to CSV output for live appends.`;
  }
  return `Could not update workbook: ${workbookPath}. ${reason}`;
}

function workbookWriteFailure(workbookPath: string, error: unknown): Error {
  const wrapped = new Error(formatWorkbookWriteFailure(workbookPath, error));
  (wrapped as Error & { cause?: unknown }).cause = error;
  return wrapped;
}

export function buildFishingCsvGrid(rows: CsvFishingRow[]): CsvGrid {
  const summaryStart = fishingCsvColumns.length + 2;
  const summaryRows = buildSummaryRows(rows);
  const height = Math.max(rows.length + 1, summaryRows.length);
  const width = summaryStart + 3;
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ''));

  fishingCsvColumns.forEach((column, index) => {
    grid[0][index] = column;
  });
  rows.forEach((row, rowIndex) => {
    fishingCsvColumns.forEach((column, columnIndex) => {
      grid[rowIndex + 1][columnIndex] = String(row[column] ?? '');
    });
  });
  summaryRows.forEach((summaryRow, rowIndex) => {
    grid[rowIndex][summaryStart] = summaryRow[0];
    grid[rowIndex][summaryStart + 1] = summaryRow[1];
    grid[rowIndex][summaryStart + 2] = summaryRow[2] ?? '';
  });

  return grid.map(trimTrailingEmptyCells);
}

async function readRawMacroRows(csvPath: string): Promise<MacroOutputRow[]> {
  let existing = '';
  try {
    existing = await readFile(csvPath, 'utf8');
  } catch {
    return [];
  }

  const records = parseCsv(existing);
  if (records.length < 2) {
    return [];
  }

  const header = records[0];
  const confidenceIndex = header.indexOf('confidence');
  const notesIndex = header.indexOf('notes');
  const fieldColumns = header.filter(
    (column, index) =>
      column &&
      !macroFixedColumns.includes(column as (typeof macroFixedColumns)[number]) &&
      !macroTrailingColumns.includes(column as (typeof macroTrailingColumns)[number]) &&
      index < (confidenceIndex >= 0 ? confidenceIndex : header.length)
  );

  return records
    .slice(1)
    .filter((record) => record.some((cell, index) => index < header.length && cell.trim()))
    .map((record) => {
      const fields: Record<string, StructuredFieldValue> = {};
      for (const field of fieldColumns) {
        fields[field] = normalizeCellValue(record[header.indexOf(field)] ?? '');
      }
      return {
        timestamp: record[header.indexOf('timestamp')] ?? '',
        workflow_name: record[header.indexOf('workflow_name')] ?? '',
        confidence: Number(record[confidenceIndex] || 0),
        notes: notesIndex >= 0 ? record[notesIndex] ?? '' : '',
        fields
      };
    });
}

function macroFieldColumns(rows: MacroOutputRow[]): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.fields)) {
      if (key.trim()) {
        columns.add(key.trim());
      }
    }
  }
  return [...columns];
}

function macroRowValues(row: MacroOutputRow, fieldColumns: string[]): string[] {
  return [
    row.timestamp,
    row.workflow_name,
    ...fieldColumns.map((field) => String(row.fields[field] ?? '')),
    String(row.confidence ?? 0),
    row.notes ?? ''
  ];
}

function buildMacroSummaryRows(rows: MacroOutputRow[], fieldColumns: string[]): string[][] {
  const summary: string[][] = [
    ['summary_metric', 'summary_value', 'summary_notes'],
    ['total_rows', String(rows.length), ''],
    ['last_updated', new Date().toISOString(), '']
  ];

  for (const field of fieldColumns) {
    const filled = rows.filter((row) => row.fields[field] !== null && String(row.fields[field] ?? '').trim() !== '').length;
    summary.push([`filled.${field}`, String(filled), 'non-empty values']);
    const numericValues = rows.map((row) => parseNumberText(String(row.fields[field] ?? ''))).filter(isNumber);
    if (numericValues.length) {
      summary.push([`avg.${field}`, formatAverage(numericValues), 'numeric values only']);
    }
  }

  return summary;
}

function writeMacroRawDataSheet(workbook: ExcelJS.Workbook, rows: MacroOutputRow[]): void {
  const fieldColumns = macroFieldColumns(rows);
  const columns = [...macroFixedColumns, ...fieldColumns, ...macroTrailingColumns];
  const sheet = workbook.addWorksheet('Raw Data');
  sheet.addRow(columns);
  for (const row of rows) {
    sheet.addRow(macroRowValues(row, fieldColumns));
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length }
  };
  sheet.getRow(1).font = { bold: true };
  sheet.columns = columns.map((column) => ({ width: Math.max(16, Math.min(42, column.length + 8)) }));
}

function writeMacroSummarySheet(workbook: ExcelJS.Workbook, rows: MacroOutputRow[]): void {
  const sheet = workbook.addWorksheet('Summary');
  const summaryRows = buildMacroSummaryRows(rows, macroFieldColumns(rows));
  for (const summaryRow of summaryRows) {
    sheet.addRow(summaryRow);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [{ width: 34 }, { width: 24 }, { width: 42 }];
}

function readMacroRowsFromWorksheet(sheet: ExcelJS.Worksheet): MacroOutputRow[] {
  const rows: MacroOutputRow[] = [];
  const headerRow = sheet.getRow(1);
  const header = (headerRow.values as unknown[]).slice(1).map((value) => String(value ?? ''));
  const confidenceIndex = header.indexOf('confidence');
  const notesIndex = header.indexOf('notes');
  const fieldColumns = header.filter(
    (column, index) =>
      column &&
      !macroFixedColumns.includes(column as (typeof macroFixedColumns)[number]) &&
      !macroTrailingColumns.includes(column as (typeof macroTrailingColumns)[number]) &&
      index < (confidenceIndex >= 0 ? confidenceIndex : header.length)
  );

  sheet.eachRow((worksheetRow, rowNumber) => {
    if (rowNumber === 1) return;
    const values = header.map((_, index) => String(worksheetRow.getCell(index + 1).value ?? ''));
    if (!values.some((value) => value.trim())) return;
    const fields: Record<string, StructuredFieldValue> = {};
    for (const field of fieldColumns) {
      fields[field] = normalizeCellValue(values[header.indexOf(field)] ?? '');
    }
    rows.push({
      timestamp: values[header.indexOf('timestamp')] ?? '',
      workflow_name: values[header.indexOf('workflow_name')] ?? '',
      confidence: Number(values[confidenceIndex] || 0),
      notes: notesIndex >= 0 ? values[notesIndex] ?? '' : '',
      fields
    });
  });
  return rows;
}

async function readRawFishingRows(csvPath: string): Promise<CsvFishingRow[]> {
  let existing = '';
  try {
    existing = await readFile(csvPath, 'utf8');
  } catch {
    return [];
  }

  const records = parseCsv(existing);
  if (records.length < 2) {
    return [];
  }

  return records
    .slice(1)
    .filter((record) => record.some((cell, index) => index < fishingCsvColumns.length && cell.trim()))
    .map((record) => {
      const row = {} as Record<keyof CsvFishingRow, string | number>;
      fishingCsvColumns.forEach((column, index) => {
        row[column] = record[index] ?? '';
      });
      row.confidence = Number(row.confidence || 0);
      return row as unknown as CsvFishingRow;
    });
}

function buildSummaryRows(rows: CsvFishingRow[]): string[][] {
  const expValues = rows.map((row) => parseNumberText(row.exp_gained)).filter(isNumber);
  const weightValues = rows.map((row) => parseNumberText(row.weight)).filter(isNumber);
  const classCounts = countBy(rows.map((row) => row.class_tier || 'unknown'));
  const baitCounts = countBy(rows.map((row) => row.bait_used || 'unknown'));
  const bestExpRow = rows.reduce<CsvFishingRow | null>((best, row) => {
    const exp = parseNumberText(row.exp_gained) ?? -Infinity;
    const bestExp = best ? parseNumberText(best.exp_gained) ?? -Infinity : -Infinity;
    return exp > bestExp ? row : best;
  }, null);

  const summary: string[][] = [
    ['summary_metric', 'summary_value', 'summary_notes'],
    ['total_catches', String(rows.length), ''],
    ['avg_exp', formatAverage(expValues), 'numeric exp_gained rows only'],
    ['avg_weight', formatAverage(weightValues), 'numeric portion of weight values'],
    ['best_exp_fish', bestExpRow ? `${bestExpRow.fish_name} (${bestExpRow.exp_gained})` : '', ''],
    ['last_updated', new Date().toISOString(), '']
  ];

  for (const [tier, count] of Object.entries(classCounts)) {
    const percent = rows.length ? `${((count / rows.length) * 100).toFixed(1)}%` : '0%';
    summary.push([`class_tier_counts.${tier}`, String(count), '']);
    summary.push([`class_tier_percentages.${tier}`, percent, '']);
  }

  for (const [bait, count] of Object.entries(baitCounts)) {
    summary.push([`bait_used_counts.${bait}`, String(count), '']);
  }

  return summary;
}

function writeRawDataSheet(workbook: ExcelJS.Workbook, rows: CsvFishingRow[]): void {
  const sheet = workbook.addWorksheet('Raw Data');
  sheet.addRow(fishingCsvColumns);
  for (const row of rows) {
    sheet.addRow(fishingCsvColumns.map((column) => row[column] ?? ''));
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: fishingCsvColumns.length }
  };
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [
    { width: 24 },
    { width: 24 },
    { width: 24 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 16 },
    { width: 12 },
    { width: 56 },
    { width: 42 }
  ];
}

function writeSummarySheet(workbook: ExcelJS.Workbook, rows: CsvFishingRow[]): void {
  const sheet = workbook.addWorksheet('Summary');
  const summaryRows = buildSummaryRows(rows);
  for (const summaryRow of summaryRows) {
    sheet.addRow(summaryRow);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [{ width: 34 }, { width: 24 }, { width: 42 }];
}

function readRowsFromWorksheet(sheet: ExcelJS.Worksheet): CsvFishingRow[] {
  const rows: CsvFishingRow[] = [];
  sheet.eachRow((worksheetRow, rowNumber) => {
    if (rowNumber === 1) return;
    const values = fishingCsvColumns.map((_, index) => String(worksheetRow.getCell(index + 1).value ?? ''));
    if (!values.some((value) => value.trim())) return;
    const row = {} as Record<keyof CsvFishingRow, string | number>;
    fishingCsvColumns.forEach((column, index) => {
      row[column] = values[index] ?? '';
    });
    row.confidence = Number(row.confidence || 0);
    rows.push(row as unknown as CsvFishingRow);
  });
  return rows;
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, rawValue) => {
    const value = rawValue.trim() || 'unknown';
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatAverage(values: number[]): string {
  if (!values.length) {
    return '';
  }
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);
}

function isNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function normalizeCellValue(value: string): StructuredFieldValue {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return numeric;
  }
  return value;
}

function parseCsv(content: string): CsvGrid {
  const rows: CsvGrid = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function serializeCsv(rows: CsvGrid): string {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function trimTrailingEmptyCells(row: string[]): string[] {
  let end = row.length;
  while (end > 0 && row[end - 1] === '') {
    end -= 1;
  }
  return row.slice(0, end);
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
