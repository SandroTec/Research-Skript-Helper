import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { WorkspaceStore, buildStyleProfile, calculateTopicScore, parseCsv, parseTopicSuggestion, type Dossier, type PodcastScript, type ResearchSource, type Topic, type TranscriptReference } from './workspace.store';
import { AiApiService, type BackendHealth } from './ai-api.service';

type View = 'dashboard' | 'analytics' | 'topics' | 'research' | 'scripts' | 'settings';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DatePipe, DecimalPipe, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly Math = Math;
  readonly store = inject(WorkspaceStore);
  readonly ai = inject(AiApiService);
  private readonly router = inject(Router);
  readonly backendHealth = signal<BackendHealth | null>(null);
  readonly busy = signal(false);
  readonly busyAction = signal('');
  readonly topicSuggestion = signal(false);
  readonly suggestedSources = signal<Array<{ id: string; title: string; publisher: string; url: string; retrievedAt: string; pinpoint: string; status: 'unreviewed'; note: string; relatedClaims: string[] }>>([]);
  readonly loadingMessage = signal('');
  readonly aiDraft = signal('');
  readonly lastCitations = signal<Array<{ url: string; title: string }>>([]);
  readonly view = signal<View>('dashboard');
  readonly notice = signal('');
  readonly importErrors = signal<string[]>([]);
  readonly topEpisodes = computed(() => [...this.store.metrics()].sort((a, b) => b.plays - a.plays).slice(0, 5));
  readonly selectedDossier = signal<string | null>(null);
  readonly selectedSourceId = signal<string | null>(null);
  readonly activeScript = signal<string | null>(null);
  readonly editingTopic = signal<string | null>(null);
  readonly words = computed(() => (this.currentScript()?.text.match(/[\p{L}\p{N}]+/gu) ?? []).length);
  readonly estimatedMinutes = computed(() => Math.ceil(this.words() / Math.max(1, this.store.settings().wordsPerMinute)));

  topicForm = { title: '', country: '', period: '', category: '', summary: '' };
  dossierForm = { facts: '', sources: '', notes: '' };
  sourceDraft: Omit<ResearchSource, 'id' | 'relatedClaims'> = { title: '', publisher: '', url: '', retrievedAt: '', pinpoint: '', status: 'unreviewed', note: '' };

  ngOnInit(): void {
    this.syncViewFromUrl();
    this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => this.syncViewFromUrl());
    if (!this.store.metrics().length) {
      fetch('/assets/analytics.csv').then(response => response.ok ? response.text() : '').then(csv => {
        if (csv) this.store.saveMetrics(parseCsv(csv).rows);
      }).catch(() => this.notice.set('Die mitgelieferte Statistikdatei konnte nicht geladen werden. Importiere sie über Analytics.'));
    }
  }

  navigate(view: View): void {
    const paths: Record<View, string> = { dashboard: '/', analytics: '/analytics', topics: '/topics', research: '/research', scripts: '/scripts', settings: '/settings' };
    this.notice.set('');
    void this.router.navigateByUrl(paths[view]);
  }
  private syncViewFromUrl(): void {
    const path = this.router.url.split(/[?#]/, 1)[0];
    const views: Record<string, View> = { '/': 'dashboard', '/analytics': 'analytics', '/topics': 'topics', '/research': 'research', '/scripts': 'scripts', '/settings': 'settings' };
    this.view.set(views[path] ?? 'dashboard');
  }
  metricCoverage(): string[] {
    const metrics = this.store.metrics();
    return [
      `${metrics.length} Episoden mit Titel${metrics.some(row => row.plays) ? ', Plays' : ''}`,
      metrics.some(row => row.releaseDate) ? 'Veröffentlichungsdaten vorhanden' : 'Veröffentlichungsdaten fehlen',
      'Themenlabels, Episodenlängen und vergleichbare Beobachtungszeiträume fehlen',
    ];
  }

  async importCsv(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const parsed = parseCsv(await file.text());
    this.importErrors.set(parsed.errors);
    if (parsed.rows.length) {
      this.store.saveMetrics(parsed.rows);
      this.notice.set(`${parsed.rows.length} Episoden importiert.`);
    } else this.notice.set('Es wurden keine gültigen Episoden importiert.');
  }

  async importTranscripts(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    const allowed = files.filter(file => /\.(txt|md|markdown)$/i.test(file.name));
    const rejected = files.filter(file => !allowed.includes(file));
    const added: TranscriptReference[] = await Promise.all(allowed.map(async file => ({ id: crypto.randomUUID(), name: file.name, text: await file.text(), importedAt: new Date().toISOString() })));
    if (added.length) {
      const all = [...this.store.transcripts(), ...added];
      this.store.saveTranscripts(all);
      const profile = buildStyleProfile(all);
      if (profile) this.store.saveProfile(profile);
      this.notice.set(`${added.length} Transkript${added.length === 1 ? '' : 'e'} importiert. Das Stilprofil wurde aktualisiert.`);
    }
    if (rejected.length) this.importErrors.set([`${rejected.map(file => file.name).join(', ')}: Nur TXT- und Markdown-Dateien werden unterstützt.`]);
    input.value = '';
  }

  rebuildProfile(): void {
    const profile = buildStyleProfile(this.store.transcripts());
    this.store.saveProfile(profile);
    this.notice.set(profile ? 'Persönliches Stilprofil aus den importierten Transkripten erstellt.' : 'Noch keine ausreichend langen Referenztranskripte. Der sachliche Standardstil bleibt aktiv.');
  }

  addTopic(): void {
    if (!this.topicForm.title.trim()) { this.notice.set('Gib mindestens einen Fallnamen ein.'); return; }
    const id = this.editingTopic() ?? crypto.randomUUID();
    const score = calculateTopicScore(this.suggestedSources().length);
    const topic: Topic = { id, ...this.topicForm, createdAt: new Date().toISOString(), score: score.score, scoreNote: score.note, sourcesCount: this.suggestedSources().length };
    this.store.saveTopics([topic, ...this.store.topics().filter(item => item.id !== id)]);
    if (!this.store.dossiers().some(item => item.topicId === id)) this.store.saveDossiers([{ id: crypto.randomUUID(), topicId: id, title: topic.title, facts: '', sources: this.suggestedSources().map(source => `${source.title} — ${source.url}`).join('\n'), sourceRecords: this.suggestedSources(), notes: '', approved: false, updatedAt: new Date().toISOString() }, ...this.store.dossiers()]);
    this.editingTopic.set(null);
    this.topicSuggestion.set(false);
    this.suggestedSources.set([]);
    this.topicForm = { title: '', country: '', period: '', category: '', summary: '' };
    this.notice.set('Thema angelegt. Ergänze Quellen und belegte Fakten im Recherche-Dossier.');
  }

  editTopic(topic: Topic): void {
    this.topicForm = { title: topic.title, country: topic.country, period: topic.period, category: topic.category, summary: topic.summary };
    this.editingTopic.set(topic.id);
    this.notice.set('Thema bearbeiten und speichern. Bestehende Recherche bleibt verknüpft.');
  }

  deleteTopic(topic: Topic): void {
    if (!window.confirm(`„${topic.title}“ und alle zugehörigen Dossiers und Skripte löschen?`)) return;
    const dossierIds = this.store.dossiers().filter(item => item.topicId === topic.id).map(item => item.id);
    this.store.saveTopics(this.store.topics().filter(item => item.id !== topic.id));
    this.store.saveDossiers(this.store.dossiers().filter(item => item.topicId !== topic.id));
    this.store.saveScripts(this.store.scripts().filter(item => !dossierIds.includes(item.dossierId)));
    this.notice.set('Thema und verknüpfte Inhalte gelöscht.');
  }

  deleteDossier(dossier: Dossier): void {
    if (!window.confirm(`Dossier „${dossier.title}“ und zugehörige Skripte löschen?`)) return;
    this.store.saveDossiers(this.store.dossiers().filter(item => item.id !== dossier.id));
    this.store.saveScripts(this.store.scripts().filter(item => item.dossierId !== dossier.id));
    this.selectedDossier.set(null);
    this.notice.set('Dossier und zugehörige Skripte gelöscht.');
  }

  deleteScript(script: PodcastScript): void {
    if (!window.confirm(`Skript „${script.title}“ löschen?`)) return;
    this.store.saveScripts(this.store.scripts().filter(item => item.id !== script.id));
    this.activeScript.set(null);
    this.notice.set('Skript gelöscht.');
  }

  deleteTranscript(reference: TranscriptReference): void {
    if (!window.confirm(`Transkript „${reference.name}“ und daraus abgeleitete Stilreferenzen entfernen?`)) return;
    const remaining = this.store.transcripts().filter(item => item.id !== reference.id);
    this.store.saveTranscripts(remaining);
    this.store.saveProfile(buildStyleProfile(remaining));
    this.notice.set('Transkript entfernt; Stilprofil aktualisiert.');
  }

  openDossier(topicId: string): void {
    const dossier = this.store.dossiers().find(item => item.topicId === topicId);
    if (!dossier) return;
    this.selectedDossier.set(dossier.id);
    this.dossierForm = { facts: dossier.facts, sources: dossier.sources, notes: dossier.notes };
    const sources = dossier.sourceRecords?.length ? dossier.sourceRecords : this.parseLegacySources(dossier.sources);
    if (sources.length && !dossier.sourceRecords?.length) this.persistSources(sources);
    this.selectedSourceId.set(sources[0]?.id ?? null);
    this.loadSourceDraft(sources[0]);
    this.view.set('research');
  }
  currentDossier(): Dossier | undefined { return this.store.dossiers().find(item => item.id === this.selectedDossier()); }

  saveDossier(approve = false): void {
    const dossier = this.currentDossier();
    if (!dossier) return;
    const sources = this.currentSources();
    if (approve && (!this.dossierForm.facts.trim() || !sources.some(source => source.url.trim()))) {
      this.notice.set('Für die Freigabe sind Fakten und Quellen erforderlich. Prüfe die Belege selbst; die App bestätigt sie nicht automatisch.');
      return;
    }
    const serializedSources = sources.map(source => `${source.title || source.url}${source.publisher ? ` — ${source.publisher}` : ''} — ${source.url}${source.pinpoint ? ` — ${source.pinpoint}` : ''}`).join('\n');
    const updated = { ...dossier, ...this.dossierForm, sources: serializedSources, sourceRecords: sources, approved: approve, updatedAt: new Date().toISOString() };
    this.store.saveDossiers(this.store.dossiers().map(item => item.id === dossier.id ? updated : item));
    const sourceCount = sources.filter(source => /https?:\/\//i.test(source.url)).length;
    const topic = this.store.topics().find(item => item.id === dossier.topicId);
    if (topic) {
      const score = calculateTopicScore(sourceCount);
      this.store.saveTopics(this.store.topics().map(item => item.id === topic.id ? { ...item, sourcesCount: sourceCount, score: score.score, scoreNote: score.note } : item));
    }
    this.notice.set(approve ? 'Dossier als redaktionell freigegeben markiert.' : 'Dossier gespeichert.');
  }

  async generateScript(dossier: Dossier): Promise<void> {
    if (!dossier.approved) { this.notice.set('Gib dieses Dossier zuerst redaktionell frei.'); return; }
    if (!dossier.facts.trim() || !dossier.sources.trim()) { this.notice.set('Ohne eingetragene Fakten und Quellen kann kein Skript erstellt werden.'); return; }
    const generated = await this.runAi('script', { dossier, styleProfile: this.store.profile(), neutralStyle: this.store.settings().neutralStyle, wordsPerMinute: this.store.settings().wordsPerMinute, approved: dossier.approved });
    if (!generated) return;
    const profile = this.store.profile();
    const style = this.store.settings().neutralStyle;
    const fallback = [
      `# ${dossier.title}`,
      `\n> Entwurf auf Basis der redaktionell eingetragenen Fakten. Bitte Aussagen und Quellen vor der Aufnahme erneut prüfen.`,
      `\n## Einstieg\nIn diesem Fall sind die gesicherten Informationen entscheidend. Wo Quellen Lücken lassen oder sich widersprechen, bleibt das offen.`,
      `\n## Hintergrund und Ablauf\n${dossier.facts.trim()}`,
      `\n## Einordnung\n${dossier.notes.trim() || 'Die verfügbaren Angaben erlauben keine weitergehende Einordnung ohne zusätzliche Quellen.'}`,
      `\n## Schluss\nDer dokumentierte Stand endet dort, wo die vorliegenden Belege enden.`,
      `\n## Quellen für die Schlussprüfung\n${dossier.sources.trim()}`,
      `\n---\nErzählvorgabe: ${style}`,
      profile ? `Persönliches Stilprofil: erstellt aus ${profile.sourceCount} Transkript(en); Orientierung an durchschnittlich ${profile.averageSentenceWords} Wörtern pro Satz und den erfassten Übergängen. Beispielpassagen werden nicht in den Entwurf kopiert.` : 'Persönliches Stilprofil: nicht vorhanden; konfigurierbarer sachlicher Standardstil verwendet.',
    ].join('\n');
    const text = generated || fallback;
    const existing = this.store.scripts().find(item => item.dossierId === dossier.id);
    const script: PodcastScript = { id: existing?.id ?? crypto.randomUUID(), dossierId: dossier.id, title: dossier.title, text, updatedAt: new Date().toISOString() };
    this.store.saveScripts([script, ...this.store.scripts().filter(item => item.id !== script.id)]);
    this.activeScript.set(script.id);
    this.view.set('scripts');
    this.notice.set('Skriptentwurf erstellt. Die Fakten sind nicht automatisch überprüft; prüfe jede Aussage anhand der Quellen.');
  }

  currentScript(): PodcastScript | undefined { return this.store.scripts().find(item => item.id === this.activeScript()) ?? this.store.scripts()[0]; }
  updateScript(text: string): void {
    const current = this.currentScript();
    if (!current) return;
    this.store.saveScripts(this.store.scripts().map(item => item.id === current.id ? { ...item, text, updatedAt: new Date().toISOString() } : item));
    this.activeScript.set(current.id);
  }
  downloadScript(format: 'txt' | 'md'): void {
    const script = this.currentScript();
    if (!script) return;
    const blob = new Blob([script.text], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${script.title.replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase()}.${format}`; anchor.click(); URL.revokeObjectURL(url);
  }
  updateSettings(style: string, speed: number): void {
    this.store.saveSettings({ neutralStyle: style.trim() || 'Sachlich, ruhig und respektvoll.', wordsPerMinute: Math.max(80, Math.min(220, Number(speed) || 125)) });
    this.notice.set('Erzählstil und Sprechgeschwindigkeit gespeichert.');
  }
  searchWeb(topic: Topic): void {
    const query = encodeURIComponent(`${topic.title} ${topic.country} ${topic.period} Gericht Urteil Fall`);
    window.open(`https://www.google.com/search?q=${query}`, '_blank', 'noopener');
  }
  async checkBackend(): Promise<void> {
    try { this.backendHealth.set(await this.ai.health()); this.notice.set('Backend verbunden.'); }
    catch (error) { this.backendHealth.set(null); this.notice.set((error as Error).message); }
  }
  saveLocalToken(value: string): void { this.ai.setToken(value.trim()); this.checkBackend(); }
  async runAi(kind: 'topics' | 'research' | 'audit' | 'script', payload: unknown): Promise<string | null> {
    if (this.busy()) return null;
    this.busy.set(true);
    this.busyAction.set(kind);
    this.loadingMessage.set(kind === 'research' ? 'Fallquellen werden gesucht und für die Prüfung zusammengestellt …' : kind === 'topics' ? 'Themen und Quellen werden recherchiert …' : kind === 'script' ? 'Skriptentwurf wird erstellt …' : 'Aussagen werden mit dem Dossier abgeglichen …');
    try { const result = await this.ai.run(kind, payload); this.lastCitations.set(result.citations ?? []); this.notice.set(`KI-Auftrag abgeschlossen. ${result.usage.inputTokens ?? '?'} Eingabe- und ${result.usage.outputTokens ?? '?'} Ausgabetoken${result.usage.webSearchCalls ? ` · ${result.usage.webSearchCalls} Websuche(n)` : ''} · ${result.usage.costUsd!.toFixed(4)} USD.`); return result.text; }
    catch (error) { this.notice.set((error as Error).message); return null; }
    finally { this.busy.set(false); this.busyAction.set(''); this.loadingMessage.set(''); }
  }
  async suggestTopics(): Promise<void> {
    if (this.busy()) return;
    if (this.topicForm.title.trim() || this.topicForm.summary.trim() || this.topicForm.country.trim()) { this.notice.set('Speichere oder verwerfe zuerst die aktuellen Formulareingaben.'); return; }
    const result = await this.runAi('topics', { analytics: this.store.metrics(), existingTopics: this.store.topics().map(topic => topic.title), missingData: ['episode topics', 'episode duration', 'comparable observation windows'], requestedSuggestions: 1 });
    if (!result) return;
    try {
      const parsed = parseTopicSuggestion(result);
      if (!parsed) throw new Error('In der Antwort wurde kein Fallname gefunden.');
      this.topicForm = parsed;
      this.suggestedSources.set(this.lastCitations().map(item => ({ id: crypto.randomUUID(), title: item.title || item.url, publisher: this.hostname(item.url), url: item.url, retrievedAt: new Date().toISOString().slice(0, 10), pinpoint: '', status: 'unreviewed' as const, note: '', relatedClaims: [] })));
      this.topicSuggestion.set(true);
    } catch (error) { this.notice.set(`Der Einzelvorschlag ließ sich nicht sauber einlesen: ${(error as Error).message}. Bitte erneut versuchen.`); }
  }
  discardTopicSuggestion(): void { this.topicForm = { title: '', country: '', period: '', category: '', summary: '' }; this.topicSuggestion.set(false); this.suggestedSources.set([]); this.notice.set('Themenvorschlag verworfen.'); }
  async researchDossier(dossier: Dossier): Promise<void> {
    const result = await this.runAi('research', { title: dossier.title, currentFacts: dossier.facts, analytics: this.store.metrics() });
    if (result) {
      this.dossierForm.notes = `${this.dossierForm.notes}\n\nKI-Recherche zur redaktionellen Prüfung:\n${result}`.trim();
      const current = this.currentSources();
      const additions = this.lastCitations().map(item => ({ id: crypto.randomUUID(), title: item.title || item.url, publisher: this.hostname(item.url), url: item.url, retrievedAt: new Date().toISOString().slice(0, 10), pinpoint: '', status: 'unreviewed' as const, note: '', relatedClaims: [] }));
      const merged = [...current];
      for (const source of additions) if (!merged.some(existing => existing.url === source.url)) merged.push(source);
      this.persistSources(merged);
      this.selectedSourceId.set(additions[0]?.id ?? merged[0]?.id ?? null);
      this.loadSourceDraft(merged.find(source => source.id === this.selectedSourceId()));
      this.saveDossier();
    }
  }
  async auditScript(script: PodcastScript): Promise<void> {
    const dossier = this.store.dossiers().find(item => item.id === script.dossierId);
    const result = await this.runAi('audit', { script: script.text, dossier });
    if (result) this.aiDraft.set(result);
  }
  currentSources(): ResearchSource[] {
    const dossier = this.currentDossier();
    if (!dossier) return [];
    return dossier.sourceRecords?.length ? dossier.sourceRecords : this.parseLegacySources(dossier.sources);
  }
  private parseLegacySources(raw: string): ResearchSource[] {
    const seen = new Set<string>();
    return raw.split(/\r?\n/).map(line => line.trim()).filter(line => /https?:\/\//i.test(line)).flatMap(line => {
      const match = line.match(/https?:\/\/\S+/i); if (!match) return [];
      const url = match[0].replace(/[),.;]+$/, ''); if (seen.has(url)) return []; seen.add(url);
      return [{ id: crypto.randomUUID(), title: line.slice(0, line.indexOf(url)).replace(/[|—–-]+\s*$/, '').trim() || url, publisher: this.hostname(url), url, retrievedAt: '', pinpoint: '', status: 'unreviewed' as const, note: '', relatedClaims: [] }];
    });
  }
  private hostname(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
  private persistSources(sources: ResearchSource[]): void {
    const dossier = this.currentDossier(); if (!dossier) return;
    this.store.saveDossiers(this.store.dossiers().map(item => item.id === dossier.id ? { ...item, sourceRecords: sources, sources: sources.map(source => `${source.title || source.url} — ${source.url}`).join('\n'), approved: false, updatedAt: new Date().toISOString() } : item));
  }
  private loadSourceDraft(source?: ResearchSource): void {
    this.sourceDraft = source ? { title: source.title, publisher: source.publisher, url: source.url, retrievedAt: source.retrievedAt, pinpoint: source.pinpoint, status: source.status, note: source.note } : { title: '', publisher: '', url: '', retrievedAt: '', pinpoint: '', status: 'unreviewed', note: '' };
  }
  selectSource(source: ResearchSource): void { this.selectedSourceId.set(source.id); this.loadSourceDraft(source); }
  addSource(): void {
    const sources = this.currentSources(); const source: ResearchSource = { title: '', publisher: '', url: '', retrievedAt: new Date().toISOString().slice(0, 10), pinpoint: '', status: 'unreviewed', note: '', id: crypto.randomUUID(), relatedClaims: [] };
    this.persistSources([...sources, source]); this.selectedSourceId.set(source.id); this.loadSourceDraft(source);
  }
  saveSource(): void {
    const id = this.selectedSourceId(); if (!id) return;
    const sources = this.currentSources().map(source => source.id === id ? { ...source, ...this.sourceDraft } : source);
    this.persistSources(sources); this.notice.set('Quelle gespeichert. Die Dossierfreigabe wurde zurückgesetzt.');
  }
  deleteSource(source: ResearchSource): void {
    if (!window.confirm(`Quelle „${source.title}“ entfernen?`)) return;
    const remaining = this.currentSources().filter(item => item.id !== source.id); this.persistSources(remaining);
    this.selectedSourceId.set(remaining[0]?.id ?? null); this.loadSourceDraft(remaining[0]);
  }
  deleteSelectedSource(): void { const source = this.currentSources().find(item => item.id === this.selectedSourceId()); if (source) this.deleteSource(source); }
  claims(): string[] { return this.dossierForm.facts.split(/\r?\n+/).map(line => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean); }
  claimLinked(claim: string): boolean { return this.currentSources().find(source => source.id === this.selectedSourceId())?.relatedClaims.includes(claim) ?? false; }
  toggleClaim(claim: string): void {
    const id = this.selectedSourceId(); if (!id) return;
    const sources = this.currentSources().map(source => source.id !== id ? source : { ...source, relatedClaims: source.relatedClaims.includes(claim) ? source.relatedClaims.filter(item => item !== claim) : [...source.relatedClaims, claim] });
    this.persistSources(sources); this.loadSourceDraft(sources.find(source => source.id === id));
  }
}
