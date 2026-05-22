import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, NgZone, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { QueryMessageComponent } from '../Components/query-message-component/query-message-component';
import { SqlReviewDraft, SqlReviewPanelComponent } from '../Components/sql-review-panel/sql-review-panel';
import { DatabaseOption } from '../Models/database';
import { AgentStep, Message } from '../Models/message';
import { QueryResponse } from '../Models/query-response';
import { AuthService } from '../Services/auth-service';
import { AgentStreamNodeEvent, QueryService } from '../Services/query-service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-quotes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, QueryMessageComponent, SqlReviewPanelComponent],
  templateUrl: './quotes.html',
  styleUrl: './quotes.css',
})
export class QuotesComponent implements OnInit {
  @ViewChild('messagesEnd') private messagesEnd?: ElementRef<HTMLDivElement>;

  readonly suggestions = [
    'Show the top 10 records by total value',
    'Summarize monthly activity trends',
    'List the most active entities this quarter',
    'Show counts grouped by status',
  ];

  input = '';
  loading = false;
  reviewLoading = false;
  databases: DatabaseOption[] = [];
  selectedDbId = '';
  databasesLoading = true;
  messages: Message[] = [];
  pendingReview: SqlReviewDraft | null = null;
  showLogsButton = environment.enableLogsUi;

  constructor(
    private readonly queryService: QueryService,
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly ngZone: NgZone,
  ) {
    this.authService.restoreFromStorage();
  }

  ngOnInit(): void {
    this.queryService.getDatabases().subscribe({
      next: (response) => {
        this.databases = response.databases;
        if (this.databases.length > 0) {
          this.selectedDbId = this.databases[0].dbId;
        }
        this.databasesLoading = false;
      },
      error: () => {
        this.databasesLoading = false;
      },
    });
  }

  get isTechTeam(): boolean {
    return this.authService.isTechTeam;
  }

  get currentUsername(): string {
    return this.authService.currentUser?.username || 'Unknown user';
  }

  get currentModeLabel(): string {
    return this.isTechTeam ? 'Tech Team Mode' : 'End User Mode';
  }

  get canSubmit(): boolean {
    return !this.loading && !this.reviewLoading && !this.pendingReview && !!this.selectedDbId;
  }

  getSelectedDbName(): string {
    return this.databases.find((db) => db.dbId === this.selectedDbId)?.displayName || 'Unknown';
  }

  applySuggestion(suggestion: string): void {
    this.input = suggestion;
  }

  trackByMessageId(_index: number, message: Message): string {
    return message.id;
  }

  async submitQuery(): Promise<void> {
    const question = this.input.trim();
    if (!question || !this.canSubmit) {
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

  async runReviewedSql(sql: string): Promise<void> {
    if (!this.pendingReview || this.reviewLoading) {
      return;
    }

    const reviewDraft = this.pendingReview;
    this.reviewLoading = true;

    try {
      const response = await firstValueFrom(this.queryService.resumeQuestion(reviewDraft.threadId, sql));

      if (response.status === 'awaiting_review') {
        this.pendingReview = this.toReviewDraft(response, reviewDraft.sourceMessageId);
        return;
      }

      this.pendingReview = null;
      if (reviewDraft.sourceMessageId) {
        this.updateAgentMessage(reviewDraft.sourceMessageId, (message) => ({
          ...message,
          ...this.createAssistantMessage(response),
          id: message.id,
          timestamp: message.timestamp,
          agentSteps: message.agentSteps,
        }));
      } else {
        this.messages = [...this.messages, this.createAssistantMessage(response)];
      }
    } catch (error) {
      this.messages = [...this.messages, this.createErrorMessage(error)];
    } finally {
      this.reviewLoading = false;
      this.scrollToBottomSoon();
    }
  }

  cancelReview(): void {
    if (!this.pendingReview) {
      return;
    }

    const cancelledQuestion = this.pendingReview.question;
    this.pendingReview = null;
    this.messages = [
      ...this.messages,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        error: 'SQL review cancelled.',
        detail: `The generated SQL for "${cancelledQuestion}" was not executed. Submit the question again to regenerate a draft.`,
        timestamp: new Date(),
      },
    ];
    this.scrollToBottomSoon();
  }

  logout(): void {
    this.authService.logout();
    this.pendingReview = null;
    this.messages = [];
    void this.router.navigate(['/login']);
  }

  private handleInitiateResponse(response: QueryResponse): void {
    if (response.status === 'awaiting_review') {
      this.pendingReview = this.toReviewDraft(response);
      return;
    }

    this.messages = [...this.messages, this.createAssistantMessage(response)];
  }

  private canRetry(retryCount?: number, maxAttempts?: number, maxRetries?: number): boolean {
    const totalAttempts = maxAttempts ?? ((maxRetries ?? 0) + 1);
    return (retryCount ?? 0) < totalAttempts;
  }

  private async submitAgentQuery(question: string): Promise<void> {
    const assistantId = crypto.randomUUID();
    const dbId = this.selectedDbId;

    this.messages = [
      ...this.messages,
      {
        id: assistantId,
        role: 'assistant',
        allowSqlView: this.isTechTeam,
        agentSteps: [{ node: 'retrieve', status: 'running' }],
        timestamp: new Date(),
      },
    ];
    this.scrollToBottomSoon();

    try {
      await this.queryService.streamAgentQuestion(question, dbId, {
        onNodeEnd: (event) => {
          this.updateAgentMessage(assistantId, (message) => {
            const isRetrying =
              (!!event.generationError || !!event.validationError || !!event.executionError) &&
              this.canRetry(event.retryCount, event.maxAttempts, event.maxRetries);

            return {
              ...message,
              agentSteps: this.advanceAgentSteps(message.agentSteps || [], event),
              sql: event.sql || message.sql,
              allowSqlView: this.isTechTeam,
              error: !isRetrying && event.generationError ? 'Unable to generate SQL for this question.' : isRetrying ? undefined : message.error,
              detail: !isRetrying && event.generationError ? event.generationError : isRetrying ? undefined : message.detail,
              phase: !isRetrying && event.generationError ? 'generation' : isRetrying ? undefined : message.phase,
              displayTarget: !isRetrying && event.generationError ? 'error-box' : isRetrying ? undefined : message.displayTarget,
              finalError: message.finalError,
              retryCount: event.retryCount ?? message.retryCount,
              maxRetries: event.maxRetries ?? message.maxRetries,
              maxAttempts: event.maxAttempts ?? message.maxAttempts,
            };
          });
        },
        onDone: (response) => {
          if (response.status === 'awaiting_review') {
            this.pendingReview = this.toReviewDraft(response, assistantId);
            this.updateAgentMessage(assistantId, (message) => ({
              ...message,
              sql: response.generatedSQL || message.sql,
              allowSqlView: this.isTechTeam,
              retrievedTables: response.retrievedTables,
              schemaContext: response.schemaContext,
              promptPreview: response.promptPreview,
              retryCount: response.retryCount ?? message.retryCount,
              maxRetries: response.maxRetries ?? message.maxRetries,
              maxAttempts: response.maxAttempts ?? message.maxAttempts,
              agentSteps: (message.agentSteps || []).map((step) =>
                step.status === 'running' ? { ...step, status: 'done' } : step,
              ),
            }));
            return;
          }

          this.updateAgentMessage(assistantId, (message) => ({
            ...message,
            sql: response.sql,
            allowSqlView: this.isTechTeam,
            data: response.data,
            error: response.error,
            detail: response.detail,
            phase: response.phase,
            displayTarget: response.displayTarget,
            code: response.code,
            finalError: response.finalError,
            retryCount: response.retryCount,
            maxRetries: response.maxRetries,
            maxAttempts: response.maxAttempts,
            retrievedTables: response.retrievedTables,
            schemaContext: response.schemaContext,
            promptPreview: response.promptPreview,
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
            retryCount: streamError.retryCount ?? message.retryCount,
            maxRetries: streamError.maxRetries ?? message.maxRetries,
            maxAttempts: streamError.maxAttempts ?? message.maxAttempts,
            agentSteps: (message.agentSteps || []).map((step) =>
              step.status === 'running' ? { ...step, status: 'error', detail: streamError.error } : step,
            ),
          }));
        },
      });
    } catch (error) {
      const fallbackResponse = (error as Error & { response?: QueryResponse }).response;

      if (fallbackResponse) {
        if (fallbackResponse.status === 'awaiting_review') {
          this.pendingReview = this.toReviewDraft(fallbackResponse, assistantId);
        }

        this.updateAgentMessage(assistantId, (message) => ({
          ...message,
          ...this.createAssistantMessage({
            ...fallbackResponse,
            sql: fallbackResponse.sql || fallbackResponse.generatedSQL,
          }),
          id: message.id,
          timestamp: message.timestamp,
          agentSteps: this.buildFallbackAgentSteps(fallbackResponse),
        }));
        return;
      }

      const response = await firstValueFrom(this.queryService.initiateQuestion(question, dbId));
      if (response.status === 'awaiting_review') {
        this.pendingReview = this.toReviewDraft(response, assistantId);
      }

      this.updateAgentMessage(assistantId, (message) => ({
        ...message,
        ...this.createAssistantMessage({
          ...response,
          sql: response.sql || response.generatedSQL,
        }),
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

    let currentIndex = -1;
    for (let index = steps.length - 1; index >= 0; index--) {
      if (steps[index].node === event.node && steps[index].status === 'running') {
        currentIndex = index;
        break;
      }
    }

    if (currentIndex === -1) {
      for (let index = steps.length - 1; index >= 0; index--) {
        if (steps[index].node === event.node) {
          currentIndex = index;
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

    if (
      !eventError &&
      event.status !== 'error' &&
      event.status !== 'awaiting_review' &&
      orderIndex >= 0 &&
      orderIndex < nodeOrder.length - 1
    ) {
      const nextNode = nodeOrder[orderIndex + 1];
      if (!steps.some((step) => step.node === nextNode && step.status === 'running')) {
        steps.push({ node: nextNode, status: 'running' });
      }
    }

    if (event.generationError && this.canRetry(event.retryCount, event.maxAttempts, event.maxRetries)) {
      steps.push({ node: 'retrieve', status: 'running', detail: 'Retrying...' });
    }

    if (event.validationError && this.canRetry(event.retryCount, event.maxAttempts, event.maxRetries)) {
      steps.push({ node: 'retrieve', status: 'running', detail: 'Retrying...' });
    }

    if (event.executionError && this.canRetry(event.retryCount, event.maxAttempts, event.maxRetries)) {
      steps.push({ node: 'generate', status: 'running', detail: 'Retrying...' });
    }

    return steps;
  }

  private buildFallbackAgentSteps(response: QueryResponse): AgentStep[] {
    if (response.status === 'awaiting_review') {
      return [
        { node: 'retrieve', status: 'done' },
        { node: 'generate', status: 'done' },
      ];
    }

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

  private toReviewDraft(response: QueryResponse, sourceMessageId?: string): SqlReviewDraft {
    return {
      question: response.question || '',
      threadId: response.threadId || '',
      sourceMessageId,
      generatedSQL: response.generatedSQL || '',
      editableSQL: response.editableSQL || response.generatedSQL || '',
      schemaContext: response.schemaContext,
      promptPreview: response.promptPreview,
      retrievedTables: response.retrievedTables,
      lastError: response.lastError,
    };
  }

  private createAssistantMessage(response: QueryResponse): Message {
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      sql: response.sql,
      allowSqlView: this.isTechTeam,
      data: response.data,
      error: response.error,
      detail: response.detail,
      phase: response.phase,
      displayTarget: response.displayTarget,
      code: response.code,
      finalError: response.finalError,
      retryCount: response.retryCount,
      maxRetries: response.maxRetries,
      maxAttempts: response.maxAttempts,
      retrievedTables: response.retrievedTables,
      schemaContext: response.schemaContext,
      promptPreview: response.promptPreview,
      tokens: response.tokens,
      timestamp: new Date(),
    };
  }

  private createErrorMessage(error: unknown): Message {
    if (error instanceof HttpErrorResponse) {
      const apiError = error.error as QueryResponse | undefined;
      return {
        id: crypto.randomUUID(),
        role: 'assistant',
        error: apiError?.error || error.message || 'Failed to connect to query engine',
        detail: apiError?.detail,
        sql: this.isTechTeam ? apiError?.sql : undefined,
        allowSqlView: this.isTechTeam,
        phase: apiError?.phase,
        displayTarget: apiError?.displayTarget,
        code: apiError?.code,
        finalError: apiError?.finalError,
        retryCount: apiError?.retryCount,
        maxRetries: apiError?.maxRetries,
        maxAttempts: apiError?.maxAttempts,
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
