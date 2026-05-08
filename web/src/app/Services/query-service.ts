import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { QueryRequest } from '../Models/query-request';
import { QueryResponse } from '../Models/query-response';

export interface AgentStreamNodeEvent {
  node: string;
  sql?: string;
  validationError?: string;
  executionError?: string;
  retryCount?: number;
  status?: string;
  rowCount?: number;
  executionTimeMs?: number;
}

export interface AgentStreamHandlers {
  onNodeEnd?: (event: AgentStreamNodeEvent) => void;
  onDone?: (response: QueryResponse) => void;
  onError?: (error: { error: string }) => void;
}

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

  submitAgentQuestion(question: string): Observable<QueryResponse> {
    const payload: QueryRequest = { question };
    return this.http.post<QueryResponse>(`${this.apiUrl}/agent-query`, payload);
  }

  async streamAgentQuestion(question: string, handlers: AgentStreamHandlers): Promise<void> {
    const payload: QueryRequest = { question };
    const response = await fetch(`${this.apiUrl}/agent-query/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = `Agent request failed with status ${response.status}`;

      try {
        const errorBody = (await response.json()) as { error?: string; detail?: string };
        errorMessage = errorBody.detail || errorBody.error || errorMessage;
      } catch {
        // Ignore JSON parse errors and keep the generic message.
      }

      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error('Streaming is not supported by the current browser response');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || '';

      for (const message of messages) {
        const lines = message.split('\n');

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith('data: ') || !eventType) {
            continue;
          }

          const data = JSON.parse(line.slice(6)) as AgentStreamNodeEvent & QueryResponse & { error?: string };

          if (eventType === 'node_end') {
            handlers.onNodeEnd?.(data);
          } else if (eventType === 'done') {
            handlers.onDone?.(data);
          } else if (eventType === 'error') {
            handlers.onError?.({ error: data.error || 'Agent stream failed' });
          }

          eventType = '';
        }
      }
    }
  }
}
