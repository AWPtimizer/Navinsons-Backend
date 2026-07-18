import ExcelJS from 'exceljs';
import type { Response } from 'express';

interface Column {
  header: string;
  key: string;
  width: number;
}

// Shared by every module's /download route — the old backend repeated this
// exact workbook/worksheet/header boilerplate six times, once per controller.
export const sendExcel = async (
  res: Response,
  sheetName: string,
  columns: Column[],
  rows: Record<string, unknown>[],
  filename: string
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = columns;
  rows.forEach((row) => worksheet.addRow(row));

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
};
