import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { AgentStep, Message } from '../../Models/message';

@Component({
  selector: 'app-query-message-component',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './query-message-component.html',
  styleUrl: './query-message-component.css',
})
export class QueryMessageComponent implements OnChanges {
  @Input({ required: true }) message!: Message;

  showSql = false;
  expandedAttempts = new Set<number>();

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['message']) {
      return;
    }

    const attempts = this.workflowAttempts;
    if (attempts.length === 0) {
      this.expandedAttempts.clear();
      return;
    }

    // Keep the latest attempt expanded by default.
    const latestIndex = attempts.length - 1;
    this.expandedAttempts = new Set<number>([latestIndex]);
  }

  toggleSql(): void {
    this.showSql = !this.showSql;
  }

  cellValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    return value === null || value === undefined ? '—' : String(value);
  }

  isNumericValue(row: Record<string, unknown>, column: string): boolean {
    return typeof row[column] === 'number';
  }

  get hasSqlBoxError(): boolean {
    return this.message.displayTarget === 'sql-box' && !!this.message.error;
  }

  get showErrorCard(): boolean {
    if (this.workflowAttempts.length > 0) {
      return false;
    }

    return !!this.message.finalError || (!!this.message.error && this.message.displayTarget !== 'sql-box');
  }

  get errorCardTitle(): string {
    return this.message.finalError?.message || this.message.error || 'Request failed';
  }

  get errorCardDetail(): string | undefined {
    return this.message.finalError?.detail || this.message.detail;
  }

  get showSqlCard(): boolean {
    return this.hasSqlBoxError || (!!this.message.sql && this.showSql);
  }

  get maxAttempts(): number {
    if (typeof this.message.maxAttempts === 'number') {
      return this.message.maxAttempts;
    }

    if (typeof this.message.maxRetries === 'number') {
      return this.message.maxRetries + 1;
    }

    return Math.max(this.workflowAttempts.length, 1);
  }

  get retryNote(): string | null {
    const maxRetries = this.message.maxRetries;
    const retriesFromWorkflow = Math.max(this.workflowAttempts.length - 1, 0);
    const fallbackRetries = this.message.retryCount ?? 0;
    const retriesUsed = typeof maxRetries === 'number'
      ? Math.min(retriesFromWorkflow || fallbackRetries, maxRetries)
      : retriesFromWorkflow || fallbackRetries;

    if (retriesUsed <= 0) {
      return null;
    }

    if (typeof maxRetries === 'number') {
      return `↻ ${retriesUsed} of ${maxRetries} retry(s) used`;
    }

    return `↻ ${retriesUsed} retry(s) used`;
  }

  get sqlToggleLabel(): string {
    return this.hasSqlBoxError ? 'SQL Generation Error' : 'Generated SQL';
  }

  workflowLabel(step: AgentStep): string {
    const labels: Record<string, string> = {
      retrieve: 'Retrieve schema',
      generate: 'Generate SQL',
      validate: 'Validate SQL',
      execute: 'Execute query',
      error: 'Error',
    };

    return labels[step.node] || step.node;
  }

  get workflowAttempts(): AgentStep[][] {
    const steps = this.message.agentSteps || [];
    if (steps.length === 0) {
      return [];
    }

    const attempts: AgentStep[][] = [];
    let currentAttempt: AgentStep[] = [];

    for (const step of steps) {
      const startsNewAttempt = step.node === 'retrieve' && currentAttempt.length > 0;

      if (startsNewAttempt) {
        attempts.push(currentAttempt);
        currentAttempt = [];
      }

      currentAttempt.push(step);
    }

    if (currentAttempt.length > 0) {
      attempts.push(currentAttempt);
    }

    return attempts;
  }

  toggleAttempt(index: number): void {
    if (this.expandedAttempts.has(index)) {
      this.expandedAttempts.delete(index);
      return;
    }

    this.expandedAttempts = new Set<number>([index]);
  }

  isAttemptExpanded(index: number): boolean {
    return this.expandedAttempts.has(index);
  }

  attemptStatus(attempt: AgentStep[]): 'running' | 'done' | 'error' {
    if (attempt.some((step) => step.status === 'error')) {
      return 'error';
    }

    if (attempt.some((step) => step.status === 'running')) {
      return 'running';
    }

    return 'done';
  }

  isLastAttempt(index: number): boolean {
    return index === this.workflowAttempts.length - 1;
  }

  showAttemptFinalError(index: number): boolean {
    return this.isLastAttempt(index) && !!this.message.finalError;
  }
}
