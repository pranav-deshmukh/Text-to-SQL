import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, NgZone, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { QueryMessageComponent } from '../Components/query-message-component/query-message-component';
import { AgentStep, Message } from '../Models/message';
import { QueryResponse } from '../Models/query-response';
import { AgentStreamNodeEvent, QueryService } from '../Services/query-service';

@Component({
  selector: 'app-quotes',
  standalone: true,
  imports: [CommonModule, FormsModule, QueryMessageComponent],
  templateUrl: './quotes.html',
  styleUrl: './quotes.css',
})
export class QuotesComponent {
  @ViewChild('messagesEnd') private messagesEnd?: ElementRef<HTMLDivElement>;

  readonly agentModeAvailable = true;

  readonly suggestions = [
    'Show total AUM by advisor',
    'Show total transaction amount by advisor',
    'Show total AUM by region',
    'Show top 10 accounts by AUM',
  ];

  input = '';
  loading = false;
  mode: 'pipeline' | 'agent' = 'pipeline';
  messages: Message[] = [];

  constructor(
    private readonly queryService: QueryService,
    private readonly ngZone: NgZone,
  ) {}

  applySuggestion(suggestion: string): void {
    this.input = suggestion;
  }

  setMode(mode: 'pipeline' | 'agent'): void {
    if (mode === 'agent' && !this.agentModeAvailable) {
      return;
    }

    this.mode = mode;
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
      if (this.mode === 'agent') {
        await this.submitAgentQuery(question);
      } else {
        const response = await firstValueFrom(this.queryService.submitQuestion(question));
        this.messages = [...this.messages, this.createAssistantMessage(response)];
      }
    } catch (error) {
      this.messages = [...this.messages, this.createErrorMessage(error)];
    } finally {
      this.loading = false;
      this.scrollToBottomSoon();
    }
  }

  get loadingLabel(): string {
    return this.mode === 'agent' ? 'Running agent workflow...' : 'Generating SQL query...';
  }

  private createAssistantMessage(response: QueryResponse): Message {
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      sql: response.sql,
      data: response.data,
      error: response.error,
      detail: response.detail,
      retryCount: response.retryCount,
      tokens: response.tokens,
      timestamp: new Date(),
    };
  }

  private async submitAgentQuery(question: string): Promise<void> {
    const assistantId = crypto.randomUUID();

    this.messages = [
      ...this.messages,
      {
        id: assistantId,
        role: 'assistant',
        agentSteps: [{ node: 'retrieve', status: 'running' }],
        timestamp: new Date(),
      },
    ];
    this.scrollToBottomSoon();

    try {
      await this.queryService.streamAgentQuestion(question, {
        onNodeEnd: (event) => {
          this.updateAgentMessage(assistantId, (message) => ({
            ...message,
            agentSteps: this.advanceAgentSteps(message.agentSteps || [], event),
            sql: event.sql || message.sql,
            retryCount: event.retryCount ?? message.retryCount,
          }));
        },
        onDone: (response) => {
          this.updateAgentMessage(assistantId, (message) => ({
            ...message,
            sql: response.sql,
            data: response.data,
            error: response.error,
            detail: response.detail,
            retryCount: response.retryCount,
            agentSteps: (message.agentSteps || []).map((step) =>
              step.status === 'running' ? { ...step, status: 'done' } : step,
            ),
          }));
        },
        onError: (streamError) => {
          this.updateAgentMessage(assistantId, (message) => ({
            ...message,
            error: streamError.error,
            agentSteps: (message.agentSteps || []).map((step) =>
              step.status === 'running' ? { ...step, status: 'error', detail: streamError.error } : step,
            ),
          }));
        },
      });
    } catch {
      const response = await firstValueFrom(this.queryService.submitAgentQuestion(question));
      this.updateAgentMessage(assistantId, (message) => ({
        ...message,
        ...this.createAssistantMessage(response),
        id: message.id,
        timestamp: message.timestamp,
        agentSteps: this.buildFallbackAgentSteps(response),
      }));
    }
  }

  private advanceAgentSteps(existingSteps: AgentStep[], event: AgentStreamNodeEvent): AgentStep[] {
    const steps = [...existingSteps];
    const eventError = event.validationError || event.executionError;
    const currentIndex = steps.findIndex((step) => step.node === event.node);
    const currentStep: AgentStep = {
      node: event.node,
      status: eventError ? 'error' : 'done',
      detail: eventError,
    };

    if (currentIndex >= 0) {
      steps[currentIndex] = currentStep;
    } else {
      steps.push(currentStep);
    }

    const nodeOrder: string[] = ['retrieve', 'generate', 'validate', 'execute'];
    const orderIndex = nodeOrder.indexOf(event.node);

    if (!eventError && orderIndex >= 0 && orderIndex < nodeOrder.length - 1) {
      const nextNode = nodeOrder[orderIndex + 1];
      if (!steps.some((step) => step.node === nextNode && step.status === 'running')) {
        steps.push({ node: nextNode, status: 'running' });
      }
    }

    if (event.validationError && (event.retryCount ?? 0) < 2) {
      steps.push({ node: 'retrieve', status: 'running', detail: 'Retrying...' });
    }

    if (event.executionError && (event.retryCount ?? 0) < 2) {
      steps.push({ node: 'generate', status: 'running', detail: 'Retrying...' });
    }

    return steps;
  }

  private buildFallbackAgentSteps(response: QueryResponse): AgentStep[] {
    const baseSteps: AgentStep[] = [
      { node: 'retrieve', status: 'done' },
      { node: 'generate', status: 'done' },
      { node: 'validate', status: response.error ? 'error' : 'done', detail: response.detail },
    ];

    if (!response.error && response.data) {
      baseSteps.push({ node: 'execute', status: 'done' });
    }

    return baseSteps;
  }

  private updateAgentMessage(messageId: string, updater: (message: Message) => Message): void {
    this.messages = this.messages.map((message) =>
      message.id === messageId ? updater(message) : message,
    );
    this.scrollToBottomSoon();
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
