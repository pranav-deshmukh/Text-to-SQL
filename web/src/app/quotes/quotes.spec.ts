import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { QuotesComponent } from './quotes';
import { QueryService } from '../Services/query-service';

describe('QuotesComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuotesComponent],
      providers: [
        {
          provide: QueryService,
          useValue: {
            submitQuestion: () => of({}),
          },
        },
      ],
    }).compileComponents();
  });

  it('creates the query screen', () => {
    const fixture = TestBed.createComponent(QuotesComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});