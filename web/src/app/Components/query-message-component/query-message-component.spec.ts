import { TestBed } from '@angular/core/testing';
import { QueryMessageComponent } from './query-message-component';

describe('QueryMessageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QueryMessageComponent],
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
});