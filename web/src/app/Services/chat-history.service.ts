import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ChatDetailResponse,
  ChatListResponse,
  CreateChatRequest,
  CreateChatResponse,
} from '../Models/chat-conversation';

@Injectable({
  providedIn: 'root',
})
export class ChatHistoryService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  getConversations(): Observable<ChatListResponse> {
    return this.http.get<ChatListResponse>(`${this.apiUrl}/chats`);
  }

  getConversation(conversationId: string): Observable<ChatDetailResponse> {
    return this.http.get<ChatDetailResponse>(`${this.apiUrl}/chats/${conversationId}`);
  }

  createConversation(payload: CreateChatRequest): Observable<CreateChatResponse> {
    return this.http.post<CreateChatResponse>(`${this.apiUrl}/chats`, payload);
  }

  archiveConversation(conversationId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/chats/${conversationId}`);
  }
}
