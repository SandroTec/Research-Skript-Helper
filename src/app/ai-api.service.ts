import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface BackendHealth {
  configured: boolean;
  models: Record<string, string>;
  maxConcurrentJobs: number;
  budgetUsd: number;
  costConfigured: boolean;
  configuredRateTasks: number;
  searchConfigured: boolean;
  maxWebSearchCallsPerJob: number;
  monthlySpendUsd: number;
  usage: Array<{ month: string; model: string; input_tokens: number | null; output_tokens: number | null; cost: number | null; created_at: string }>;
}
export interface AiResult { jobId: string; text: string; citations: Array<{ url: string; title: string; start: number; end: number }>; usage: { inputTokens: number | null; outputTokens: number | null; webSearchCalls: number; webSearchCostUsd: number; costUsd: number | null; monthlyCostUsd: number | null } }

@Injectable({ providedIn: 'root' })
export class AiApiService {
  readonly token = signal(sessionStorage.getItem('inside-verbrechen.local-token') ?? '');
  constructor(private readonly http: HttpClient) {}
  setToken(value: string): void { this.token.set(value); sessionStorage.setItem('inside-verbrechen.local-token', value); }
  private options() { return { headers: new HttpHeaders({ 'X-Local-Token': this.token() }) }; }
  health(): Promise<BackendHealth> { return firstValueFrom(this.http.get<BackendHealth>('/api/health', this.options())); }
  async run(kind: 'topics' | 'research' | 'script' | 'audit', payload: unknown): Promise<AiResult> {
    try { return await firstValueFrom(this.http.post<AiResult>(`/api/ai/${kind}`, payload, this.options())); }
    catch (error) { const response = error as HttpErrorResponse; throw new Error(response.error?.error || response.message || 'Backend nicht erreichbar.'); }
  }
  jobs(): Promise<Array<{ id: string; kind: string; status: string; error: string | null; created_at: string }>> { return firstValueFrom(this.http.get<Array<{ id: string; kind: string; status: string; error: string | null; created_at: string }>>('/api/jobs', this.options())); }
}
