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
      await this.submitAgentQuery(question);
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
      phase: response.phase,
      displayTarget: response.displayTarget,
      code: response.code,
      finalError: response.finalError,
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
          this.updateAgentMessage(assistantId, (message) => {
            const isRetrying =
              (!!event.generationError || !!event.validationError || !!event.executionError) &&
              (event.retryCount ?? 0) < 2;

            return {
              ...message,
              agentSteps: this.advanceAgentSteps(message.agentSteps || [], event),
              sql: event.sql || message.sql,
              // Only surface the error on UI if this is the final failure (not mid-retry)
              error: !isRetrying && event.generationError ? 'Unable to generate SQL for this question.' : isRetrying ? undefined : message.error,
              detail: !isRetrying && event.generationError ? event.generationError : isRetrying ? undefined : message.detail,
              phase: !isRetrying && event.generationError ? 'generation' : isRetrying ? undefined : message.phase,
              displayTarget: !isRetrying && event.generationError ? 'error-box' : isRetrying ? undefined : message.displayTarget,
              finalError: message.finalError,
              retryCount: event.retryCount ?? message.retryCount,
            };
          });
        },
        onDone: (response) => {
          this.updateAgentMessage(assistantId, (message) => ({
            ...message,
            sql: response.sql,
            data: response.data,
            error: response.error,
            detail: response.detail,
            phase: response.phase,
            displayTarget: response.displayTarget,
            code: response.code,
            finalError: response.finalError,
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
            detail: streamError.detail,
            phase: streamError.phase,
            displayTarget: streamError.displayTarget,
            code: streamError.code,
            finalError: streamError.finalError,
            agentSteps: (message.agentSteps || []).map((step) =>
              step.status === 'running' ? { ...step, status: 'error', detail: streamError.error } : step,
            ),
          }));
        },
      });
    } catch (error) {
      const fallbackResponse = (error as Error & { response?: QueryResponse }).response;

      if (fallbackResponse) {
        this.updateAgentMessage(assistantId, (message) => ({
          ...message,
          ...this.createAssistantMessage(fallbackResponse),
          id: message.id,
          timestamp: message.timestamp,
          agentSteps: this.buildFallbackAgentSteps(fallbackResponse),
        }));
        return;
      }

      const response = await firstValueFrom(this.queryService.submitQuestion(question));
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
    const eventError = event.generationError || event.validationError || event.executionError;

    if (event.node === 'error') {
      return steps.map((step) =>
        step.status === 'running'
          ? { ...step, status: 'error', detail: eventError || step.detail }
          : step,
      );
    }

    // Find the last step matching this node (prefer 'running' state, else last occurrence)
    let currentIndex = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].node === event.node && steps[i].status === 'running') {
        currentIndex = i;
        break;
      }
    }
    if (currentIndex === -1) {
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].node === event.node) {
          currentIndex = i;
          break;
        }
      }
    }

    const currentStep: AgentStep = {
      node: event.node,
      status: eventError || event.status === 'error' ? 'error' : 'done',
      detail: eventError,
    };

    if (currentIndex >= 0) {
      steps[currentIndex] = currentStep;
    } else {
      steps.push(currentStep);
    }

    const nodeOrder: string[] = ['retrieve', 'generate', 'validate', 'execute'];
    const orderIndex = nodeOrder.indexOf(event.node);

    if (!eventError && event.status !== 'error' && orderIndex >= 0 && orderIndex < nodeOrder.length - 1) {
      const nextNode = nodeOrder[orderIndex + 1];
      if (!steps.some((step) => step.node === nextNode && step.status === 'running')) {
        steps.push({ node: nextNode, status: 'running' });
      }
    }

    // Generation retry → re-retrieve with error context, starts a new Try block
    if (event.generationError && (event.retryCount ?? 0) < 2) {
      steps.push({ node: 'retrieve', status: 'running', detail: 'Retrying...' });
    }

    // Validation retry → re-retrieve with error context, starts a new Try block
    if (event.validationError && (event.retryCount ?? 0) < 2) {
      steps.push({ node: 'retrieve', status: 'running', detail: 'Retrying...' });
    }

    // Execution retry → skip re-retrieve, go straight to generate with error context
    if (event.executionError && (event.retryCount ?? 0) < 2) {
      steps.push({ node: 'generate', status: 'running', detail: 'Retrying...' });
    }

    return steps;
  }

  private buildFallbackAgentSteps(response: QueryResponse): AgentStep[] {
    if (response.phase === 'generation') {
      return [
        { node: 'retrieve', status: 'done' },
        { node: 'generate', status: 'error', detail: response.detail },
      ];
    }

    if (response.phase === 'execution') {
      return [
        { node: 'retrieve', status: 'done' },
        { node: 'generate', status: 'done' },
        { node: 'validate', status: 'done' },
        { node: 'execute', status: 'error', detail: response.detail },
      ];
    }

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
        phase: apiError?.phase,
        displayTarget: apiError?.displayTarget,
        code: apiError?.code,
        finalError: apiError?.finalError,
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
