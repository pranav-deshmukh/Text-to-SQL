import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, NgZone, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { QueryMessageComponent } from '../Components/query-message-component/query-message-component';
import { Message } from '../Models/message';
import { QueryResponse } from '../Models/query-response';
import { QueryService } from '../Services/query-service';

@Component({
  selector: 'app-quotes',
  standalone: true,
  imports: [CommonModule, FormsModule, QueryMessageComponent],
  templateUrl: './quotes.html',
  styleUrl: './quotes.css',
})
export class QuotesComponent {
  @ViewChild('messagesEnd') private messagesEnd?: ElementRef<HTMLDivElement>;

  readonly suggestions = [
    'Show total AUM by advisor',
    'Show total transaction amount by advisor',
    'Show total AUM by region',
    'Show top 10 accounts by AUM',
  ];

  input = '';
  loading = false;
  messages: Message[] = [];

  constructor(
    private readonly queryService: QueryService,
    private readonly ngZone: NgZone,
  ) {}

  applySuggestion(suggestion: string): void {
    this.input = suggestion;
  }

  trackByMessageId(_index: number, message: Message): string {
    return message.id;
  }

  async submitQuery(): Promise<void> {
    const question = this.input.trim();
    if (!question || this.loading) {
      return;
    }

    this.input = '';
    this.messages = [
      ...this.messages,
      {
        id: crypto.randomUUID(),
        role: 'user',
        question,
        timestamp: new Date(),
      },
    ];
    this.loading = true;
    this.scrollToBottomSoon();

    try {
      const response = await firstValueFrom(this.queryService.submitQuestion(question));
      this.messages = [...this.messages, this.createAssistantMessage(response)];
    } catch (error) {
      this.messages = [...this.messages, this.createErrorMessage(error)];
    } finally {
      this.loading = false;
      this.scrollToBottomSoon();
    }
  }

  private createAssistantMessage(response: QueryResponse): Message {
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      sql: response.sql,
      data: response.data,
      error: response.error,
      detail: response.detail,
      tokens: response.tokens,
      timestamp: new Date(),
    };
  }

  private createErrorMessage(error: unknown): Message {
    if (error instanceof HttpErrorResponse) {
      const httpError = error;
      const apiError = httpError.error as QueryResponse | undefined;
      return {
        id: crypto.randomUUID(),
        role: 'assistant',
        error:
          apiError?.error ||
          httpError.message ||
          'Failed to connect to query engine',
        detail: apiError?.detail,
        sql: apiError?.sql,
        timestamp: new Date(),
      };
    }

    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      error: error instanceof Error ? error.message : 'Failed to connect to query engine',
      timestamp: new Date(),
    };
  }

  private scrollToBottomSoon(): void {
    this.ngZone.onStable.pipe(take(1)).subscribe(() => {
      requestAnimationFrame(() => {
        this.messagesEnd?.nativeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
      });
    });
  }
}
