import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { AgentStep, Message } from '../../Models/message';

@Component({
  selector: 'app-query-message-component',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './query-message-component.html',
  styleUrl: './query-message-component.css',
})
export class QueryMessageComponent {
  @Input({ required: true }) message!: Message;

  showSql = false;

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
    if (this.message.phase === 'generation' && !!this.message.agentSteps?.length) {
      return false;
    }

    return !!this.message.error && this.message.displayTarget !== 'sql-box';
  }

  get showSqlCard(): boolean {
    return this.hasSqlBoxError || (!!this.message.sql && this.showSql);
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
}
