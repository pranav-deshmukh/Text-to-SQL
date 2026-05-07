import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Message } from '../../Models/message';

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
}
