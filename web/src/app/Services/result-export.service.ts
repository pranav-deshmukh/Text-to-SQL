import { Injectable } from '@angular/core';
import { QueryResult } from '../Models/query-result';

export type ExportFormat = 'csv' | 'excel' | 'pdf';

type ExportCellValue = string | number | boolean;

interface PreparedDataset {
  columns: string[];
  typedRows: ExportCellValue[][];
  textRows: string[][];
}

interface ExportTheme {
  headerBgHex: string;
  headerTextHex: string;
  bodyTextHex: string;
  borderHex: string;
  headerBgRgb: [number, number, number];
  headerTextRgb: [number, number, number];
  bodyTextRgb: [number, number, number];
  borderRgb: [number, number, number];
  landscapeColumnThreshold: number;
}

@Injectable({
  providedIn: 'root',
})
export class ResultExportService {
  async exportResults(format: ExportFormat, result: QueryResult): Promise<void> {
    const dataset = this.prepareDataset(result);

    switch (format) {
      case 'csv':
        this.exportCsv(dataset);
        return;
      case 'excel':
        await this.exportExcel(dataset);
        return;
      case 'pdf':
        await this.exportPdf(dataset);
        return;
      default:
        this.assertUnsupportedFormat(format);
    }
  }

  private assertUnsupportedFormat(format: never): never {
    throw new Error(`Unsupported export format: ${String(format)}`);
  }

  private prepareDataset(result: QueryResult): PreparedDataset {
    const columns = result.columns ?? [];
    const rows = result.rows ?? [];

    if (columns.length === 0 || rows.length === 0) {
      throw new Error('There are no results to download.');
    }

    const typedRows = rows.map((row) =>
      columns.map((column) => this.normalizeCellValue(row[column])),
    );

    return {
      columns,
      typedRows,
      textRows: typedRows.map((row) => row.map((value) => this.stringifyCellValue(value))),
    };
  }

  private normalizeCellValue(value: unknown): ExportCellValue {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value) || typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  private stringifyCellValue(value: ExportCellValue): string {
    return typeof value === 'string' ? value : String(value);
  }

  private exportCsv(dataset: PreparedDataset): void {
    const lines = [
      dataset.columns.map((column) => this.escapeCsvValue(column)).join(','),
      ...dataset.textRows.map((row) => row.map((value) => this.escapeCsvValue(value)).join(',')),
    ];

    const csv = `\uFEFF${lines.join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    this.saveBlob(blob, this.buildFileName('csv'));
  }

  private escapeCsvValue(value: string): string {
    const escapedValue = value.replaceAll('"', '""');
    const needsQuotes = /[",\n\r]/.test(escapedValue);
    return needsQuotes ? `"${escapedValue}"` : escapedValue;
  }

  private async exportExcel(dataset: PreparedDataset): Promise<void> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Results', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const theme = this.getTheme();

    worksheet.addRow(dataset.columns);
    dataset.typedRows.forEach((row) => {
      worksheet.addRow(row);
    });

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        color: { argb: this.hexToExcelArgb(theme.headerTextHex) },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: this.hexToExcelArgb(theme.headerBgHex) },
      };
      cell.alignment = {
        horizontal: 'left',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: this.hexToExcelArgb(theme.borderHex) } },
        left: { style: 'thin', color: { argb: this.hexToExcelArgb(theme.borderHex) } },
        bottom: { style: 'thin', color: { argb: this.hexToExcelArgb(theme.borderHex) } },
        right: { style: 'thin', color: { argb: this.hexToExcelArgb(theme.borderHex) } },
      };
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      row.eachCell((cell) => {
        cell.font = {
          bold: false,
          color: { argb: this.hexToExcelArgb(theme.bodyTextHex) },
        };
        cell.alignment = {
          horizontal: typeof cell.value === 'number' ? 'right' : 'left',
          vertical: 'top',
          wrapText: true,
        };
      });
    });

    worksheet.columns.forEach((column, index) => {
      const maxCellLength = Math.max(
        dataset.columns[index]?.length ?? 0,
        ...dataset.textRows.map((row) => row[index]?.length ?? 0),
      );
      column.width = Math.min(Math.max(maxCellLength + 2, 12), 40);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    this.saveBlob(blob, this.buildFileName('excel'));
  }

  private async exportPdf(dataset: PreparedDataset): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const theme = this.getTheme();
    const isLandscape = dataset.columns.length > theme.landscapeColumnThreshold;
    const doc = new jsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit: 'pt',
      format: 'a4',
    });

    autoTable(doc, {
      head: [dataset.columns],
      body: dataset.textRows,
      startY: 24,
      margin: { top: 24, right: 24, bottom: 24, left: 24 },
      styles: {
        fontSize: isLandscape ? 8 : 9,
        cellPadding: 6,
        overflow: 'linebreak',
        valign: 'middle',
        textColor: theme.bodyTextRgb,
        lineColor: theme.borderRgb,
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: theme.headerBgRgb,
        textColor: theme.headerTextRgb,
        fontStyle: 'bold',
        halign: 'left',
      },
      bodyStyles: {
        textColor: theme.bodyTextRgb,
      },
      alternateRowStyles: {
        fillColor: [249, 250, 251],
      },
      tableWidth: 'auto',
      showHead: 'everyPage',
    });

    const blob = doc.output('blob');
    this.saveBlob(blob, this.buildFileName('pdf'));
  }

  private saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private buildFileName(format: ExportFormat): string {
    const timestamp = this.formatTimestamp(new Date());
    const extension = format === 'excel' ? 'xlsx' : format;
    return `query-results-${timestamp}.${extension}`;
  }

  private formatTimestamp(date: Date): string {
    const parts = [
      date.getFullYear(),
      this.pad(date.getMonth() + 1),
      this.pad(date.getDate()),
    ];
    const time = [
      this.pad(date.getHours()),
      this.pad(date.getMinutes()),
      this.pad(date.getSeconds()),
    ];

    return `${parts.join('-')}_${time.join('-')}`;
  }

  private pad(value: number): string {
    return String(value).padStart(2, '0');
  }

  private getTheme(): ExportTheme {
    const styles = getComputedStyle(document.documentElement);
    const headerBgHex = this.readCssVar(styles, '--teal-primary', '#0ea5a0');
    const headerTextHex = this.readCssVar(styles, '--text-inverse', '#ffffff');
    const bodyTextHex = this.readCssVar(styles, '--text-primary', '#1a2332');
    const borderHex = this.readCssVar(styles, '--border', '#e2e8f0');

    return {
      headerBgHex,
      headerTextHex,
      bodyTextHex,
      borderHex,
      headerBgRgb: this.hexToRgb(headerBgHex),
      headerTextRgb: this.hexToRgb(headerTextHex),
      bodyTextRgb: this.hexToRgb(bodyTextHex),
      borderRgb: this.hexToRgb(borderHex),
      landscapeColumnThreshold: 8,
    };
  }

  private readCssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
    return styles.getPropertyValue(name).trim() || fallback;
  }

  private hexToExcelArgb(hexColor: string): string {
    const normalized = hexColor.replace('#', '');
    if (normalized.length === 3) {
      return `FF${normalized
        .split('')
        .map((value) => `${value}${value}`)
        .join('')}`.toUpperCase();
    }

    return `FF${normalized}`.toUpperCase();
  }

  private hexToRgb(hexColor: string): [number, number, number] {
    const normalized = hexColor.replace('#', '');
    const fullHex = normalized.length === 3
      ? normalized.split('').map((value) => `${value}${value}`).join('')
      : normalized;

    const red = Number.parseInt(fullHex.slice(0, 2), 16);
    const green = Number.parseInt(fullHex.slice(2, 4), 16);
    const blue = Number.parseInt(fullHex.slice(4, 6), 16);

    return [red, green, blue];
  }
}
