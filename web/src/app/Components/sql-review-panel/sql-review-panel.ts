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
  @Output() regenerate = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  editableSql = '';
  showContext = false;
  showPrompt = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['draft']) {
      this.editableSql = this.draft?.editableSQL || this.draft?.generatedSQL || '';
    }
  }

  submit(): void {
    const sql = this.editableSql.trim();
    if (!sql || this.loading) {
      return;
    }

    this.runSql.emit(sql);
  }
}
