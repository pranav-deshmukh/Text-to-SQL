import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { QueryService } from './query-service';
import { environment } from '../../environments/environment';

describe('QueryService', () => {
  let service: QueryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [QueryService, provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(QueryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts the question to the query endpoint', () => {
    service.submitQuestion('Show total AUM by advisor').subscribe();

    const request = httpMock.expectOne(`${environment.apiUrl}/query`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ question: 'Show total AUM by advisor' });

    request.flush({ sql: 'SELECT 1' });
  });
});