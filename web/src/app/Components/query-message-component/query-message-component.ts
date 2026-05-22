import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { AgentStep, Message } from '../../Models/message';
import { ExportFormat, ResultExportService } from '../../Services/result-export.service';

type PaginationItem = number | 'ellipsis';
type DownloadMenuDirection = 'down' | 'up';

@Component({
  selector: 'app-query-message-component',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './query-message-component.html',
  styleUrl: './query-message-component.css',
})
export class QueryMessageComponent implements OnChanges {
  readonly pageSize = 100;
  readonly downloadMenuOffset = 8;
  @Input({ required: true }) message!: Message;
  @ViewChild('downloadTrigger') private downloadTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('downloadMenu') private downloadMenu?: ElementRef<HTMLDivElement>;

  readonly downloadOptions: Array<{ format: ExportFormat; label: string; description: string }> = [
    { format: 'csv', label: 'CSV', description: 'Comma-separated values' },
    { format: 'excel', label: 'Excel', description: 'Styled spreadsheet (.xlsx)' },
    { format: 'pdf', label: 'PDF', description: 'Formatted table document' },
  ];

  showSql = false;
  expandedAttempts = new Set<number>();
  downloadMenuOpen = false;
  downloadMenuDirection: DownloadMenuDirection = 'down';
  activeExportFormat: ExportFormat | null = null;
  exportErrorMessage: string | null = null;
  currentPage = 1;

  constructor(
    private readonly resultExportService: ResultExportService,
    private readonly hostElement: ElementRef<HTMLElement>,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['message']) {
      return;
    }

    this.currentPage = 1;
    this.closeDownloadMenu();
    this.activeExportFormat = null;
    this.exportErrorMessage = null;

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

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (!this.hostElement.nativeElement.contains(target)) {
      this.closeDownloadMenu();
    }
  }

  @HostListener('window:resize')
  handleWindowResize(): void {
    if (!this.downloadMenuOpen) {
      return;
    }

    this.updateDownloadMenuPosition();
  }

  toggleDownloadMenu(event: MouseEvent): void {
    event.stopPropagation();

    if (!this.canDownloadResults || this.isExporting) {
      return;
    }

    this.exportErrorMessage = null;

    if (this.downloadMenuOpen) {
      this.closeDownloadMenu();
      return;
    }

    this.downloadMenuOpen = true;
    requestAnimationFrame(() => this.updateDownloadMenuPosition());
  }

  async downloadResults(format: ExportFormat, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (!this.canDownloadResults || !this.message.data || this.isExporting) {
      return;
    }

    this.closeDownloadMenu();
    this.exportErrorMessage = null;
    this.activeExportFormat = format;

    try {
      await this.resultExportService.exportResults(format, this.message.data);
    } catch (error) {
      this.exportErrorMessage = error instanceof Error ? error.message : 'Unable to download results.';
    } finally {
      this.activeExportFormat = null;
    }
  }

  previousPage(): void {
    if (!this.canGoToPreviousPage) {
      return;
    }

    this.currentPage -= 1;
  }

  nextPage(): void {
    if (!this.canGoToNextPage) {
      return;
    }

    this.currentPage += 1;
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) {
      return;
    }

    this.currentPage = page;
  }

  selectPaginationItem(item: PaginationItem): void {
    if (item === 'ellipsis') {
      return;
    }

    this.goToPage(item);
  }

  isActivePage(item: PaginationItem): boolean {
    return item !== 'ellipsis' && item === this.currentPage;
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

  get canDownloadResults(): boolean {
    const data = this.message.data;
    return !!data && !this.message.error && data.columns.length > 0 && data.rowCount > 0;
  }

  get paginatedRows(): Array<Record<string, unknown>> {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.resultRows.slice(startIndex, startIndex + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(Math.ceil(this.resultRows.length / this.pageSize), 1);
  }

  get canGoToPreviousPage(): boolean {
    return this.currentPage > 1;
  }

  get canGoToNextPage(): boolean {
    return this.currentPage < this.totalPages;
  }

  get shouldShowPagination(): boolean {
    return this.resultRows.length > this.pageSize;
  }

  get pageRangeStart(): number {
    if (this.resultRows.length === 0) {
      return 0;
    }

    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageRangeEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.resultRows.length);
  }

  get paginationItems(): PaginationItem[] {
    if (this.totalPages <= 7) {
      return Array.from({ length: this.totalPages }, (_, index) => index + 1);
    }

    const pages = new Set<number>([1, this.totalPages]);

    if (this.currentPage <= 4) {
      [2, 3, 4, 5].forEach((page) => pages.add(page));
    } else if (this.currentPage >= this.totalPages - 3) {
      [this.totalPages - 4, this.totalPages - 3, this.totalPages - 2, this.totalPages - 1]
        .forEach((page) => pages.add(page));
    } else {
      [this.currentPage - 1, this.currentPage, this.currentPage + 1].forEach((page) => pages.add(page));
    }

    const sortedPages = [...pages].filter((page) => page > 0 && page <= this.totalPages).sort((left, right) => left - right);
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

  get isExporting(): boolean {
    return this.activeExportFormat !== null;
  }

  get downloadButtonLabel(): string {
    if (this.activeExportFormat) {
      return `Preparing ${this.formatLabel(this.activeExportFormat)}...`;
    }

    return 'Download';
  }

  isFormatBusy(format: ExportFormat): boolean {
    return this.activeExportFormat === format;
  }

  formatLabel(format: ExportFormat): string {
    const option = this.downloadOptions.find((downloadOption) => downloadOption.format === format);
    return option?.label ?? format.toUpperCase();
  }

  calculateDownloadMenuDirection(
    triggerRect: Pick<DOMRect, 'top' | 'bottom'>,
    menuHeight: number,
    viewportHeight: number,
  ): DownloadMenuDirection {
    const requiredSpace = menuHeight + this.downloadMenuOffset;
    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    if (spaceBelow >= requiredSpace || spaceBelow >= spaceAbove) {
      return 'down';
    }

    return 'up';
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

  private get resultRows(): Array<Record<string, unknown>> {
    return this.message.data?.rows ?? [];
  }

  private closeDownloadMenu(): void {
    this.downloadMenuOpen = false;
    this.downloadMenuDirection = 'down';
  }

  private updateDownloadMenuPosition(): void {
    const triggerElement = this.downloadTrigger?.nativeElement;
    const menuElement = this.downloadMenu?.nativeElement;

    if (!triggerElement || !menuElement) {
      this.downloadMenuDirection = 'down';
      return;
    }

    const footerEl = document.querySelector('.footer-shell');
    const effectiveBottom = footerEl
      ? footerEl.getBoundingClientRect().top
      : window.innerHeight;

    this.downloadMenuDirection = this.calculateDownloadMenuDirection(
      triggerElement.getBoundingClientRect(),
      menuElement.offsetHeight,
      effectiveBottom,
    );
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
