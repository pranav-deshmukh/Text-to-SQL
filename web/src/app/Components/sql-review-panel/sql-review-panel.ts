import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface SqlReviewDraft {
  question: string;
  threadId: string;
  sourceMessageId?: string;
  generatedSQL: string;
  editableSQL: string;
  schemaContext?: string;
  promptPreview?: {
    systemPrompt: string;
    userPrompt: string;
  };
  retrievedTables?: string[];
  availableColumns?: { tableName: string; columns: { name: string; dataType: string }[] }[];
  lastError?: {
    phase: 'validation' | 'execution';
    message: string;
  };
}

@Component({
  selector: 'app-sql-review-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sql-review-panel.html',
  styleUrl: './sql-review-panel.css',
})
export class SqlReviewPanelComponent implements OnChanges {
  @Input({ required: true }) draft!: SqlReviewDraft;
  @Input() loading = false;
  @Output() runSql = new EventEmitter<string>();
  @Output() regenerate = new EventEmitter<string[]>();
  @Output() cancel = new EventEmitter<void>();

  editableSql = '';
  showContext = false;
  showPrompt = false;
  showAvailableColumns = false;
  selectedNeededColumns = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['draft']) {
      this.editableSql = this.draft?.editableSQL || this.draft?.generatedSQL || '';
      this.selectedNeededColumns.clear();
    }
  }

  get hasAvailableColumns(): boolean {
    return !!this.draft?.availableColumns?.length;
  }

  get totalAvailableColumnCount(): number {
    if (!this.draft?.availableColumns) return 0;
    return this.draft.availableColumns.reduce((sum, table) => sum + table.columns.length, 0);
  }

  toggleNeededColumn(qualifiedName: string, isChecked: boolean): void {
    if (isChecked) {
      this.selectedNeededColumns.add(qualifiedName);
    } else {
      this.selectedNeededColumns.delete(qualifiedName);
    }
  }

  isNeededColumnSelected(qualifiedName: string): boolean {
    return this.selectedNeededColumns.has(qualifiedName);
  }

  regenerateWithColumns(): void {
    if (this.loading) return;
    const columns = Array.from(this.selectedNeededColumns);
    this.regenerate.emit(columns);
  }

  submit(): void {
    const sql = this.editableSql.trim();
    if (!sql || this.loading) {
      return;
    }

    this.runSql.emit(sql);
  }
}
