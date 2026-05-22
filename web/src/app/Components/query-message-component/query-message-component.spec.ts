import { TestBed } from '@angular/core/testing';
import { QueryMessageComponent } from './query-message-component';
import { ResultExportService } from '../../Services/result-export.service';

describe('QueryMessageComponent', () => {
  let exportServiceSpy: jasmine.SpyObj<ResultExportService>;

  beforeEach(async () => {
    exportServiceSpy = jasmine.createSpyObj<ResultExportService>('ResultExportService', ['exportResults']);
    exportServiceSpy.exportResults.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [QueryMessageComponent],
      providers: [
        { provide: ResultExportService, useValue: exportServiceSpy },
      ],
    }).compileComponents();
  });

  it('renders a user message', () => {
    const fixture = TestBed.createComponent(QueryMessageComponent);
    fixture.componentInstance.message = {
      id: '1',
      role: 'user',
      question: 'Test question',
      timestamp: new Date(),
    };

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Test question');
  });

  it('enables downloads for successful result sets', () => {
    const fixture = TestBed.createComponent(QueryMessageComponent);
    fixture.componentInstance.message = {
      id: '2',
      role: 'assistant',
      data: {
        columns: ['Advisor', 'AUM'],
        rows: [{ Advisor: 'Jane', AUM: 1250 }],
        rowCount: 1,
        executionTimeMs: 42,
      },
      timestamp: new Date(),
    };

    fixture.detectChanges();

    expect(fixture.componentInstance.canDownloadResults).toBeTrue();
  });

  it('paginates the rendered rows in groups of 100', () => {
    const fixture = TestBed.createComponent(QueryMessageComponent);
    fixture.componentInstance.message = {
      id: '3',
      role: 'assistant',
      data: {
        columns: ['Index'],
        rows: Array.from({ length: 150 }, (_, index) => ({ Index: index + 1 })),
        rowCount: 150,
        executionTimeMs: 42,
      },
      timestamp: new Date(),
    };

    fixture.detectChanges();

    expect(fixture.componentInstance.shouldShowPagination).toBeTrue();
    expect(fixture.componentInstance.paginatedRows.length).toBe(100);
    expect(fixture.componentInstance.totalPages).toBe(2);
    expect(fixture.componentInstance.paginationItems).toEqual([1, 2]);
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(100);

    fixture.componentInstance.nextPage();
    fixture.detectChanges();

    expect(fixture.componentInstance.currentPage).toBe(2);
    expect(fixture.componentInstance.paginatedRows.length).toBe(50);
    expect(fixture.componentInstance.pageRangeStart).toBe(101);
    expect(fixture.componentInstance.pageRangeEnd).toBe(150);
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(50);
  });

  it('renders compact numbered pagination with ellipses for larger result sets', () => {
    const fixture = TestBed.createComponent(QueryMessageComponent);
    fixture.componentInstance.message = {
      id: '4',
      role: 'assistant',
      data: {
        columns: ['Index'],
        rows: Array.from({ length: 1000 }, (_, index) => ({ Index: index + 1 })),
        rowCount: 1000,
        executionTimeMs: 42,
      },
      timestamp: new Date(),
    };

    fixture.detectChanges();

    expect(fixture.componentInstance.paginationItems).toEqual([1, 2, 3, 4, 5, 'ellipsis', 10]);

    fixture.componentInstance.goToPage(4);
    fixture.detectChanges();

    expect(fixture.componentInstance.paginationItems).toEqual([1, 2, 3, 4, 5, 'ellipsis', 10]);
    expect(fixture.nativeElement.textContent).toContain('Showing 301-400 of 1000 rows');

    fixture.componentInstance.goToPage(8);
    fixture.detectChanges();

    expect(fixture.componentInstance.paginationItems).toEqual([1, 'ellipsis', 6, 7, 8, 9, 10]);
  });

  it('exports the full result set instead of the current page only', async () => {
    const fixture = TestBed.createComponent(QueryMessageComponent);
    const result = {
      columns: ['Index'],
      rows: Array.from({ length: 150 }, (_, index) => ({ Index: index + 1 })),
      rowCount: 150,
      executionTimeMs: 42,
    };

    fixture.componentInstance.message = {
      id: '5',
      role: 'assistant',
      data: result,
      timestamp: new Date(),
    };

    fixture.detectChanges();
    fixture.componentInstance.nextPage();

    await fixture.componentInstance.downloadResults('csv', new MouseEvent('click'));

    expect(exportServiceSpy.exportResults).toHaveBeenCalledOnceWith('csv', result);
    expect(fixture.componentInstance.currentPage).toBe(2);
  });
});