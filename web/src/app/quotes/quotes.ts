import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { Subscription, combineLatest, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { QueryMessageComponent } from '../Components/query-message-component/query-message-component';
import { SqlReviewDraft, SqlReviewPanelComponent } from '../Components/sql-review-panel/sql-review-panel';
import { ChatConversationMessage, ChatConversationSummary } from '../Models/chat-conversation';
import { DatabaseOption } from '../Models/database';
import { AgentStep, Message } from '../Models/message';
import { QueryResponse } from '../Models/query-response';
import { AuthService } from '../Services/auth-service';
import { ChatHistoryService } from '../Services/chat-history.service';
import { AgentStreamNodeEvent, QueryService } from '../Services/query-service';
import { environment } from '../../environments/environment';

const locallyDeletedConversationIds = new Set<string>();

@Component({
  selector: 'app-quotes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, QueryMessageComponent, SqlReviewPanelComponent],
  templateUrl: './quotes.html',
  styleUrl: './quotes.css',
})
export class QuotesComponent implements OnInit, OnDestroy {
  @ViewChild('messagesEnd') private messagesEnd?: ElementRef<HTMLDivElement>;
  private readonly sidebarStateStorageKey = 'queryassist.chats.sidebar.collapsed';

  readonly suggestions = [
    'Show the top 10 records by total value',
    'Summarize monthly activity trends',
    'List the most active entities this quarter',
    'Show counts grouped by status',
  ];

  input = '';
  loading = false;
  reviewLoading = false;
  historyLoading = false;
  conversationsLoading = true;
  databasesLoading = true;
  databases: DatabaseOption[] = [];
  selectedDbId = '';
  messages: Message[] = [];
  conversations: ChatConversationSummary[] = [];
  pendingReview: SqlReviewDraft | null = null;
  profileMenuOpen = false;
  dbMenuOpen = false;
  conversationMenuOpenId: string | null = null;
  renamingConversationId: string | null = null;
  renameDraft = '';
  pendingDeleteConversation: ChatConversationSummary | null = null;
  activeConversationId: string | null = null;
  showLogsButton = environment.enableLogsUi;
  sidebarCollapsed = this.readSidebarCollapsed();
  isArchivedView = false;

  private routeSubscription?: Subscription;

  constructor(
    private readonly queryService: QueryService,
    private readonly authService: AuthService,
    private readonly chatHistoryService: ChatHistoryService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly ngZone: NgZone,
  ) {
    this.authService.restoreFromStorage();
  }

  ngOnInit(): void {
    void this.loadDatabases();
    this.routeSubscription = combineLatest([this.route.paramMap, this.route.data]).subscribe(([params, data]) => {
      const archivedView = data['archivedView'] === true;
      const archivedViewChanged = this.isArchivedView !== archivedView;

      this.isArchivedView = archivedView;

      if (archivedViewChanged) {
        this.closeConversationControls();
        this.profileMenuOpen = false;
        this.dbMenuOpen = false;
      }

      void this.handleRouteChange(params, archivedViewChanged);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  @HostListener('document:click')
  closeProfileMenu(): void {
    this.profileMenuOpen = false;
    this.dbMenuOpen = false;
    this.conversationMenuOpenId = null;
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    this.closeDeleteModal();
    this.cancelRenamingConversation();
    this.conversationMenuOpenId = null;
    this.profileMenuOpen = false;
    this.dbMenuOpen = false;
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

  get currentUserInitial(): string {
    return this.currentUsername.slice(0, 1).toUpperCase();
  }

  get currentConversationTitle(): string {
    if (!this.activeConversationId) {
      return this.isArchivedView ? 'Archived chats' : 'New chat';
    }

    return (
      this.conversations.find((item) => item.conversationId === this.activeConversationId)?.title ||
      (this.isArchivedView ? 'Archived chat' : 'Saved chat')
    );
  }

  get currentDatabaseLabel(): string {
    if (this.databasesLoading) {
      return 'Loading databases...';
    }

    if (!this.selectedDbId) {
      return 'Select a database';
    }

    return this.getSelectedDbName();
  }

  get canSubmit(): boolean {
    return !this.isArchivedView && !this.loading && !this.reviewLoading && !this.pendingReview && !!this.selectedDbId && !this.historyLoading;
  }

  get hasSavedConversations(): boolean {
    return this.conversations.length > 0;
  }

  get canChangeDatabase(): boolean {
    return !this.isArchivedView && !this.loading && !this.reviewLoading && !this.pendingReview && !this.historyLoading;
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

  trackByConversationId(_index: number, conversation: ChatConversationSummary): string {
    return conversation.conversationId;
  }

  async startNewChat(): Promise<void> {
    if (this.isArchivedView) {
      await this.router.navigate(['/']);
      return;
    }

    this.closeConversationControls();
    this.pendingReview = null;
    this.messages = [];
    this.input = '';
    this.activeConversationId = null;
    await this.router.navigate(['/']);
  }

  async openConversation(conversationId: string): Promise<void> {
    if (conversationId === this.activeConversationId) {
      return;
    }

    this.closeConversationControls();
    await this.router.navigate(this.isArchivedView ? ['/archives', conversationId] : ['/chat', conversationId]);
  }

  toggleDbMenu(event: MouseEvent): void {
    event.stopPropagation();

    if (this.databasesLoading || !this.canChangeDatabase) {
      return;
    }

    this.dbMenuOpen = !this.dbMenuOpen;
  }

  selectDatabase(dbId: string): void {
    if (!this.canChangeDatabase || this.selectedDbId === dbId) {
      this.dbMenuOpen = false;
      return;
    }

    this.selectedDbId = dbId;
    this.dbMenuOpen = false;
  }

  toggleProfileMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.profileMenuOpen = !this.profileMenuOpen;
  }

  toggleSidebar(event: MouseEvent): void {
    event.stopPropagation();
    this.sidebarCollapsed = !this.sidebarCollapsed;
    localStorage.setItem(this.sidebarStateStorageKey, String(this.sidebarCollapsed));
    this.profileMenuOpen = false;
    this.dbMenuOpen = false;
    this.conversationMenuOpenId = null;
    this.cancelRenamingConversation();
  }

  async goToArchiveSection(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    await this.router.navigate(this.isArchivedView ? ['/'] : ['/archives']);
  }

  isConversationMenuOpen(conversationId: string): boolean {
    return this.conversationMenuOpenId === conversationId;
  }

  isRenamingConversation(conversationId: string): boolean {
    return this.renamingConversationId === conversationId;
  }

  toggleConversationMenu(event: MouseEvent, conversationId: string): void {
    event.stopPropagation();
    this.profileMenuOpen = false;
    this.dbMenuOpen = false;
    this.conversationMenuOpenId = this.conversationMenuOpenId === conversationId ? null : conversationId;
  }

  startRenamingConversation(event: MouseEvent, conversation: ChatConversationSummary): void {
    if (this.isArchivedView) {
      return;
    }

    event.stopPropagation();
    this.conversationMenuOpenId = null;
    this.renamingConversationId = conversation.conversationId;
    this.renameDraft = conversation.title;
  }

  cancelRenamingConversation(event?: Event): void {
    event?.stopPropagation();
    this.renamingConversationId = null;
    this.renameDraft = '';
  }

  async submitRenameConversation(event: Event, conversationId: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (this.isArchivedView) {
      return;
    }

    const title = this.renameDraft.trim();
    if (!title) {
      return;
    }

    try {
      await firstValueFrom(this.chatHistoryService.renameConversation(conversationId, { title }));
      await this.refreshConversations();
      this.cancelRenamingConversation();
    } catch {
      // Keep current title visible if rename fails.
    }
  }

  async archiveConversation(event: MouseEvent, conversationId: string): Promise<void> {
    if (this.isArchivedView) {
      return;
    }

    event.stopPropagation();
    this.conversationMenuOpenId = null;

    try {
      await firstValueFrom(this.chatHistoryService.archiveConversation(conversationId));
      await this.handleConversationRemoved(conversationId);
    } catch {
      // Keep UI stable if archive fails.
    }
  }

  async moveConversationToChats(event: MouseEvent, conversationId: string): Promise<void> {
    event.stopPropagation();
    this.conversationMenuOpenId = null;

    try {
      await firstValueFrom(this.chatHistoryService.unarchiveConversation(conversationId));
      await this.handleConversationRemoved(conversationId);
    } catch {
      // Keep UI stable if restore fails.
    }
  }

  requestDeleteConversation(event: MouseEvent, conversation: ChatConversationSummary): void {
    event.stopPropagation();
    this.conversationMenuOpenId = null;
    this.pendingDeleteConversation = conversation;
  }

  closeDeleteModal(event?: Event): void {
    event?.stopPropagation();
    this.pendingDeleteConversation = null;
  }

  async confirmDeleteConversation(event?: Event): Promise<void> {
    event?.stopPropagation();

    if (!this.pendingDeleteConversation) {
      return;
    }

    const { conversationId } = this.pendingDeleteConversation;
    const isActiveConversation = this.activeConversationId === conversationId;

    this.closeDeleteModal();
    locallyDeletedConversationIds.add(conversationId);
    this.removeConversationFromList(conversationId);

    if (isActiveConversation) {
      this.pendingReview = null;
      this.messages = [];
      this.activeConversationId = null;
      await this.router.navigate(this.getCurrentListRoute(), { replaceUrl: true });
    }

    try {
      await firstValueFrom(this.chatHistoryService.deleteConversation(conversationId));
      await this.refreshConversations();
    } catch {
      locallyDeletedConversationIds.delete(conversationId);
      await this.refreshConversations();
    }
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
        conversationId: this.activeConversationId || undefined,
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
      const response = await firstValueFrom(
        this.queryService.resumeQuestion(reviewDraft.threadId, sql, this.activeConversationId || undefined),
      );

      if (response.status === 'awaiting_review') {
        this.pendingReview = this.toReviewDraft(response, reviewDraft.sourceMessageId);
        if (reviewDraft.sourceMessageId) {
          this.updateAgentMessage(reviewDraft.sourceMessageId, (message) => ({
            ...message,
            sql: response.editableSQL || response.generatedSQL || message.sql,
            generatedSQL: response.generatedSQL,
            editableSQL: response.editableSQL,
            threadId: response.threadId,
            status: 'awaiting_review',
            schemaContext: response.schemaContext,
            promptPreview: response.promptPreview,
            retrievedTables: response.retrievedTables,
            lastError: response.lastError || null,
          }));
        }
      } else {
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
      }

      await this.handleConversationMutation(response.conversationId);
    } catch (error) {
      this.messages = [...this.messages, this.createErrorMessage(error)];
    } finally {
      this.reviewLoading = false;
      this.scrollToBottomSoon();
    }
  }

  async cancelReview(): Promise<void> {
    if (!this.pendingReview || this.reviewLoading) {
      return;
    }

    const reviewDraft = this.pendingReview;
    this.reviewLoading = true;

    try {
      const response = await firstValueFrom(this.queryService.cancelReview(reviewDraft.threadId));
      this.pendingReview = null;
      this.messages = [
        ...this.messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          error: 'SQL review cancelled.',
          detail:
            response.detail ||
            `The generated SQL for "${reviewDraft.question}" was not executed. Submit the question again to regenerate a draft.`,
          timestamp: new Date(),
        },
      ];
    } catch (error) {
      this.messages = [...this.messages, this.createErrorMessage(error)];
    } finally {
      this.reviewLoading = false;
      this.scrollToBottomSoon();
    }
  }

  logout(): void {
    this.authService.logout();
    this.profileMenuOpen = false;
    this.pendingReview = null;
    this.messages = [];
    void this.router.navigate(['/login']);
  }

  formatConversationTime(value: string | null): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) {
      return 'Just now';
    }

    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }

    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }

    return date.toLocaleDateString();
  }

  isConversationActive(conversationId: string): boolean {
    return this.activeConversationId === conversationId;
  }

  private async handleRouteChange(params: ParamMap, forceRefresh = false): Promise<void> {
    const conversationId = params.get('conversationId');

    if (forceRefresh || this.conversations.length === 0) {
      await this.refreshConversations();
    }

    // If we already have this conversation's messages in memory (e.g. after a mutation
    // that navigated here), skip reloading to preserve runtime-only state like agentSteps.
    if (conversationId && conversationId === this.activeConversationId && this.messages.length > 0 && !forceRefresh) {
      return;
    }

    this.activeConversationId = conversationId;
    this.pendingReview = null;

    if (!conversationId) {
      this.messages = [];
      this.historyLoading = false;
      this.scrollToBottomSoon();
      return;
    }

    this.historyLoading = true;

    try {
      const response = await firstValueFrom(
        this.chatHistoryService.getConversation(conversationId, { archived: this.isArchivedView }),
      );
      const conversation = response.conversation;
      this.activeConversationId = conversation.conversationId;
      if (conversation.selectedDbId) {
        this.selectedDbId = conversation.selectedDbId;
      }
      this.messages = conversation.messages.map((message) => this.mapStoredMessage(message));
      this.pendingReview = this.buildPendingReviewFromMessages(this.messages);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.activeConversationId = null;
        this.messages = [];
        await this.router.navigate(this.getCurrentListRoute(), { replaceUrl: true });
      }
    } finally {
      this.historyLoading = false;
      this.scrollToBottomSoon();
    }
  }

  private async loadDatabases(): Promise<void> {
    this.databasesLoading = true;

    try {
      const response = await firstValueFrom(this.queryService.getDatabases());
      this.databases = response.databases;
      if (!this.selectedDbId && this.databases.length > 0) {
        this.selectedDbId = this.databases[0].dbId;
      }
    } finally {
      this.databasesLoading = false;
    }
  }

  private async refreshConversations(): Promise<void> {
    this.conversationsLoading = true;

    try {
      const response = await firstValueFrom(this.chatHistoryService.getConversations({ archived: this.isArchivedView }));
      this.conversations = response.conversations.filter(
        (conversation) => !locallyDeletedConversationIds.has(conversation.conversationId),
      );
    } finally {
      this.conversationsLoading = false;
    }
  }

  private async handleConversationMutation(conversationId?: string): Promise<void> {
    await this.refreshConversations();

    if (conversationId && conversationId !== this.activeConversationId) {
      this.activeConversationId = conversationId;
      await this.router.navigate(['/chat', conversationId], { replaceUrl: true });
    }
  }

  private closeConversationControls(): void {
    this.conversationMenuOpenId = null;
    this.renamingConversationId = null;
    this.renameDraft = '';
    this.pendingDeleteConversation = null;
  }

  private async handleConversationRemoved(conversationId: string): Promise<void> {
    this.closeConversationControls();
    this.removeConversationFromList(conversationId);
    await this.refreshConversations();

    if (this.activeConversationId === conversationId) {
      this.pendingReview = null;
      this.messages = [];
      this.input = '';
      this.activeConversationId = null;
      await this.router.navigate(this.getCurrentListRoute(), { replaceUrl: true });
    }
  }

  private getCurrentListRoute(): string[] {
    return this.isArchivedView ? ['/archives'] : ['/'];
  }

  private removeConversationFromList(conversationId: string): void {
    this.conversations = this.conversations.filter((conversation) => conversation.conversationId !== conversationId);
  }

  private async submitAgentQuery(question: string): Promise<void> {
    const assistantId = crypto.randomUUID();
    const dbId = this.selectedDbId;
    const conversationId = this.activeConversationId || undefined;

    this.messages = [
      ...this.messages,
      {
        id: assistantId,
        conversationId,
        role: 'assistant',
        allowSqlView: this.isTechTeam,
        agentSteps: [{ node: 'retrieve', status: 'running' }],
        timestamp: new Date(),
      },
    ];
    this.scrollToBottomSoon();

    try {
      await this.queryService.streamAgentQuestion(
        question,
        dbId,
        {
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
                conversationId: response.conversationId || message.conversationId,
                sql: response.editableSQL || response.generatedSQL || message.sql,
                generatedSQL: response.generatedSQL,
                editableSQL: response.editableSQL,
                threadId: response.threadId,
                status: 'awaiting_review',
                allowSqlView: this.isTechTeam,
                retrievedTables: response.retrievedTables,
                schemaContext: response.schemaContext,
                promptPreview: response.promptPreview,
                retryCount: response.retryCount ?? message.retryCount,
                maxRetries: response.maxRetries ?? message.maxRetries,
                maxAttempts: response.maxAttempts ?? message.maxAttempts,
                lastError: response.lastError || null,
                agentSteps: (message.agentSteps || []).map((step) =>
                  step.status === 'running' ? { ...step, status: 'done' } : step,
                ),
              }));
            } else {
              this.updateAgentMessage(assistantId, (message) => ({
                ...message,
                ...this.createAssistantMessage(response),
                id: message.id,
                timestamp: message.timestamp,
                agentSteps: (message.agentSteps || []).map((step) =>
                  step.status === 'running' ? { ...step, status: 'done' } : step,
                ),
              }));
            }

            void this.handleConversationMutation(response.conversationId);
          },
          onError: (streamError) => {
            this.updateAgentMessage(assistantId, (message) => ({
              ...message,
              conversationId: streamError.conversationId || message.conversationId,
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

            void this.handleConversationMutation(streamError.conversationId);
          },
        },
        conversationId,
      );
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
        await this.handleConversationMutation(fallbackResponse.conversationId);
        return;
      }

      const response = await firstValueFrom(this.queryService.initiateQuestion(question, dbId, conversationId));
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
      await this.handleConversationMutation(response.conversationId);
    }
  }

  private canRetry(retryCount?: number, maxAttempts?: number, maxRetries?: number): boolean {
    const totalAttempts = maxAttempts ?? ((maxRetries ?? 0) + 1);
    return (retryCount ?? 0) < totalAttempts;
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

  private buildPendingReviewFromMessages(messages: Message[]): SqlReviewDraft | null {
    const message = [...messages].reverse().find((item) => item.status === 'awaiting_review' && item.threadId);
    if (!message) {
      return null;
    }

    return {
      question: message.question || '',
      threadId: message.threadId || '',
      sourceMessageId: message.id,
      generatedSQL: message.generatedSQL || message.sql || '',
      editableSQL: message.editableSQL || message.generatedSQL || message.sql || '',
      schemaContext: message.schemaContext,
      promptPreview: message.promptPreview,
      retrievedTables: message.retrievedTables,
      lastError: message.lastError || undefined,
    };
  }

  private mapStoredMessage(message: ChatConversationMessage): Message {
    return {
      id: message.messageId,
      conversationId: message.conversationId,
      role: message.role === 'user' ? 'user' : 'assistant',
      question: message.question || undefined,
      responseText: message.responseText || undefined,
      sql: message.sql || message.editableSQL || message.generatedSQL || undefined,
      generatedSQL: message.generatedSQL || undefined,
      editableSQL: message.editableSQL || undefined,
      threadId: message.threadId || undefined,
      dbId: message.dbId || undefined,
      status: message.status || undefined,
      allowSqlView: this.isTechTeam,
      retrievedTables: message.retrievedTables,
      schemaContext: message.schemaContext || undefined,
      promptPreview: message.promptPreview || undefined,
      data: message.result || undefined,
      error: message.error || undefined,
      detail: message.detail || undefined,
      phase: message.phase || undefined,
      displayTarget: message.displayTarget || undefined,
      code: message.code || undefined,
      finalError: message.finalError,
      tokens: message.tokens || undefined,
      agentSteps: message.agentSteps || undefined,
      retryCount: message.retryCount || undefined,
      maxRetries: message.maxRetries || undefined,
      maxAttempts: message.maxAttempts || undefined,
      lastError: message.lastError,
      timestamp: new Date(message.createdAt),
    };
  }

  private createAssistantMessage(response: QueryResponse): Message {
    return {
      id: crypto.randomUUID(),
      conversationId: response.conversationId,
      role: 'assistant',
      question: response.question,
      sql: response.sql || response.editableSQL || response.generatedSQL,
      generatedSQL: response.generatedSQL,
      editableSQL: response.editableSQL,
      threadId: response.threadId,
      status: response.status,
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
      lastError: response.lastError,
      timestamp: new Date(),
    };
  }

  private createErrorMessage(error: unknown): Message {
    if (error instanceof HttpErrorResponse) {
      const apiError = error.error as QueryResponse | undefined;
      return {
        id: crypto.randomUUID(),
        conversationId: apiError?.conversationId,
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

  private readSidebarCollapsed(): boolean {
    return localStorage.getItem(this.sidebarStateStorageKey) === 'true';
  }
}
