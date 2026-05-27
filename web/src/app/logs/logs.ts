import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuditRequestRecord } from '../Models/audit-log';
import { DatabaseOption } from '../Models/database';
import { AuthService } from '../Services/auth-service';
import { AuditLogFilters, QueryService } from '../Services/query-service';

type PaginationItem = number | 'ellipsis';

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './logs.html',
  styleUrl: './logs.css',
})
export class LogsComponent implements OnInit {
  private readonly sidebarStateStorageKey = 'queryassist.logs.sidebar.collapsed';
  readonly pageSizeOptions = [25, 50, 100];
  loading = false;
  error = '';
  records: AuditRequestRecord[] = [];
  databases: DatabaseOption[] = [];
  expandedRequestId = '';
  profileMenuOpen = false;
  sidebarCollapsed = this.readSidebarCollapsed();

  total = 0;
  page = 1;
  pageSize = 25;

  filters: AuditLogFilters = {
    q: '',
    status: '',
    stage: '',
    dbId: '',
    env: 'all',
    from: '',
    to: '',
    page: 1,
    pageSize: 25,
  };

  readonly stages = [
    'request_received',
    'input_validation',
    'context_retrieval',
    'llm_sql_generation',
    'sql_safety_validation',
    'sql_execution',
    'review_cancelled',
    'response_formatting',
    'request_completed',
  ];

  constructor(
    private readonly queryService: QueryService,
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {
    this.authService.restoreFromStorage();
  }

  ngOnInit(): void {
    this.loadDatabases();
    void this.loadLogs();
  }

  @HostListener('document:click')
  closeMenus(): void {
    this.profileMenuOpen = false;
  }

  loadDatabases(): void {
    this.queryService.getDatabases().subscribe({
      next: (response) => {
        this.databases = response.databases;
      },
      error: () => {
        this.databases = [];
      },
    });
  }

  async loadLogs(page: number = 1): Promise<void> {
    this.loading = true;
    this.error = '';
    this.page = page;
    this.expandedRequestId = '';

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
      this.filters.page = response.page;
      this.filters.pageSize = response.pageSize;
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
      dbId: '',
      env: 'all',
      from: '',
      to: '',
      page: 1,
      pageSize: this.pageSize,
    };
    await this.loadLogs(1);
  }

  async previousPage(): Promise<void> {
    if (!this.hasPrevPage || this.loading) {
      return;
    }

    await this.loadLogs(this.page - 1);
  }

  async nextPage(): Promise<void> {
    if (!this.hasNextPage || this.loading) {
      return;
    }

    await this.loadLogs(this.page + 1);
  }

  async goToPage(page: number): Promise<void> {
    if (page < 1 || page > this.totalPages || page === this.page || this.loading) {
      return;
    }

    await this.loadLogs(page);
  }

  async selectPaginationItem(item: PaginationItem): Promise<void> {
    if (item === 'ellipsis') {
      return;
    }

    await this.goToPage(item);
  }

  async onPageSizeChange(pageSize: number | string): Promise<void> {
    const parsedPageSize = Number(pageSize);
    if (!this.pageSizeOptions.includes(parsedPageSize) || parsedPageSize === this.pageSize) {
      return;
    }

    this.pageSize = parsedPageSize;
    this.filters.page = 1;
    this.filters.pageSize = parsedPageSize;
    await this.loadLogs(1);
  }

  toggleProfileMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.profileMenuOpen = !this.profileMenuOpen;
  }

  toggleSidebar(event: MouseEvent): void {
    event.stopPropagation();
    this.sidebarCollapsed = !this.sidebarCollapsed;
    localStorage.setItem(this.sidebarStateStorageKey, String(this.sidebarCollapsed));
    this.profileMenuOpen = false;
  }

  async goToChats(): Promise<void> {
    this.profileMenuOpen = false;
    await this.router.navigate(['/']);
  }

  async goToArchives(): Promise<void> {
    this.profileMenuOpen = false;
    await this.router.navigate(['/archives']);
  }

  logout(): void {
    this.authService.logout();
    this.profileMenuOpen = false;
    void this.router.navigate(['/login']);
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

  get currentUsername(): string {
    return this.authService.currentUser?.username || 'Unknown user';
  }

  get currentModeLabel(): string {
    return this.authService.isTechTeam ? 'Tech Team Mode' : 'End User Mode';
  }

  get currentUserInitial(): string {
    return this.currentUsername.slice(0, 1).toUpperCase();
  }

  get hasNextPage(): boolean {
    return this.page * this.pageSize < this.total;
  }

  get totalPages(): number {
    return Math.max(Math.ceil(this.total / this.pageSize), 1);
  }

  get pageRangeStart(): number {
    if (this.total === 0) {
      return 0;
    }

    return (this.page - 1) * this.pageSize + 1;
  }

  get pageRangeEnd(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }

  get shouldShowPagination(): boolean {
    return this.total > this.pageSize;
  }

  get paginationItems(): PaginationItem[] {
    if (this.totalPages <= 7) {
      return Array.from({ length: this.totalPages }, (_value, index) => index + 1);
    }

    const pages = new Set<number>([1, this.totalPages]);

    if (this.page <= 4) {
      [2, 3, 4, 5].forEach((page) => pages.add(page));
    } else if (this.page >= this.totalPages - 3) {
      [this.totalPages - 4, this.totalPages - 3, this.totalPages - 2, this.totalPages - 1].forEach((page) =>
        pages.add(page),
      );
    } else {
      [this.page - 1, this.page, this.page + 1].forEach((page) => pages.add(page));
    }

    const sortedPages = [...pages]
      .filter((page) => page > 0 && page <= this.totalPages)
      .sort((left, right) => left - right);
    const items: PaginationItem[] = [];

    sortedPages.forEach((page, index) => {
      const previousPage = sortedPages[index - 1];
      if (previousPage && page - previousPage > 1) {
        items.push('ellipsis');
      }

      items.push(page);
    });

    return items;
  }

  isActivePage(item: PaginationItem): boolean {
    return item !== 'ellipsis' && item === this.page;
  }

  get successCount(): number {
    return this.records.filter((record) => record.status === 'success').length;
  }

  get errorCount(): number {
    return this.records.filter((record) => record.status === 'error').length;
  }

  get cancelledCount(): number {
    return this.records.filter((record) => record.status === 'cancelled').length;
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

  private readSidebarCollapsed(): boolean {
    return localStorage.getItem(this.sidebarStateStorageKey) === 'true';
  }
}
