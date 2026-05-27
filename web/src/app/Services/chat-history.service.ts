import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ChatDetailResponse,
  ChatListResponse,
  CreateChatRequest,
  CreateChatResponse,
  RenameChatRequest,
  RenameChatResponse,
} from '../Models/chat-conversation';

@Injectable({
  providedIn: 'root',
})
export class ChatHistoryService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  getConversations(options?: { archived?: boolean }): Observable<ChatListResponse> {
    return this.http.get<ChatListResponse>(`${this.apiUrl}/chats`, {
      params: this.buildArchivedParams(options?.archived),
    });
  }

  getConversation(conversationId: string, options?: { archived?: boolean }): Observable<ChatDetailResponse> {
    return this.http.get<ChatDetailResponse>(`${this.apiUrl}/chats/${conversationId}`, {
      params: this.buildArchivedParams(options?.archived),
    });
  }

  createConversation(payload: CreateChatRequest): Observable<CreateChatResponse> {
    return this.http.post<CreateChatResponse>(`${this.apiUrl}/chats`, payload);
  }

  renameConversation(conversationId: string, payload: RenameChatRequest): Observable<RenameChatResponse> {
    return this.http.patch<RenameChatResponse>(`${this.apiUrl}/chats/${conversationId}`, payload);
  }

  archiveConversation(conversationId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/chats/${conversationId}/archive`, {});
  }

  unarchiveConversation(conversationId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/chats/${conversationId}/unarchive`, {});
  }

  deleteConversation(conversationId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/chats/${conversationId}`);
  }

  private buildArchivedParams(archived?: boolean): HttpParams | undefined {
    if (!archived) {
      return undefined;
    }

    return new HttpParams().set('archived', 'true');
  }
}
