import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { QueryRequest } from '../Models/query-request';
import { QueryResponse } from '../Models/query-response';

@Injectable({
  providedIn: 'root',
})
export class QueryService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  submitQuestion(question: string): Observable<QueryResponse> {
    const payload: QueryRequest = { question };
    return this.http.post<QueryResponse>(`${this.apiUrl}/query`, payload);
  }
}
