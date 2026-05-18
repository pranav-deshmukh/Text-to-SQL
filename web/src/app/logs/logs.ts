import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuditRequestRecord } from '../Models/audit-log';
import { AuditLogFilters, QueryService } from '../Services/query-service';

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './logs.html',
  styleUrl: './logs.css',
})
export class LogsComponent implements OnInit {
  loading = false;
  error = '';
  records: AuditRequestRecord[] = [];
  expandedRequestId = '';

  total = 0;
  page = 1;
  pageSize = 20;

  filters: AuditLogFilters = {
    q: '',
    status: '',
    stage: '',
    from: '',
    to: '',
    page: 1,
    pageSize: 20,
  };

  readonly stages = [
    'request_received',
    'input_validation',
    'context_retrieval',
    'llm_sql_generation',
    'sql_safety_validation',
    'sql_execution',
    'response_formatting',
    'request_completed',
  ];

  constructor(private readonly queryService: QueryService) {}

  ngOnInit(): void {
    void this.loadLogs();
  }

  async loadLogs(page: number = 1): Promise<void> {
    this.loading = true;
    this.error = '';
    this.page = page;

    try {
      const response = await firstValueFrom(
        this.queryService.getAuditLogs({
          ...this.filters,
          page,
          pageSize: this.pageSize,
        }),
      );

      this.records = response.items;
      this.total = response.total;
      this.page = response.page;
      this.pageSize = response.pageSize;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unable to load logs.';
    } finally {
      this.loading = false;
    }
  }

  async applyFilters(): Promise<void> {
    await this.loadLogs(1);
  }

  async resetFilters(): Promise<void> {
    this.filters = {
      q: '',
      status: '',
      stage: '',
      from: '',
      to: '',
      page: 1,
      pageSize: this.pageSize,
    };
    await this.loadLogs(1);
  }

  toggleExpand(requestId: string): void {
    this.expandedRequestId = this.expandedRequestId === requestId ? '' : requestId;
  }

  trackByRequestId(_index: number, item: AuditRequestRecord): string {
    return item.requestId;
  }

  get hasPrevPage(): boolean {
    return this.page > 1;
  }

  get hasNextPage(): boolean {
    return this.page * this.pageSize < this.total;
  }

  get successCount(): number {
    return this.records.filter((record) => record.status === 'success').length;
  }

  get errorCount(): number {
    return this.records.filter((record) => record.status === 'error').length;
  }

  get displayedCount(): number {
    return this.records.length;
  }

  formatStageName(stage: string): string {
    return stage
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  getRequestDurationMs(record: AuditRequestRecord): number {
    if (!record.completedAt) {
      return 0;
    }

    const start = new Date(record.startedAt).getTime();
    const end = new Date(record.completedAt).getTime();
    return Math.max(0, end - start);
  }

  getErrorSummary(record: AuditRequestRecord): string {
    const stageWithError = record.stages.find((stage) => stage.status === 'error' && stage.error?.message);
    return stageWithError?.error?.message || 'No error details available';
  }

  async copyRequestId(requestId: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await navigator.clipboard.writeText(requestId);
  }
}
