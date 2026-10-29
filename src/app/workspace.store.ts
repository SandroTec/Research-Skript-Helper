import { Injectable, signal } from '@angular/core';

export interface EpisodeMetric {
  title: string;
  plays: number;
  streams: number;
  audienceSize: number;
  releaseDate: string;
}

export interface TranscriptReference {
  id: string;
  name: string;
  text: string;
  importedAt: string;
}

export interface StyleProfile {
  sourceCount: number;
  sourceNames: string[];
  generatedAt: string;
  wordCount: number;
  averageSentenceWords: number;
  paragraphCount: number;
  openingExamples: string[];
  transitionWords: string[];
  notes: string[];
}

export interface Topic {
  id: string;
  title: string;
  country: string;
  period: string;
  category: string;
  summary: string;
  createdAt: string;
  score: number;
  scoreNote: string;
  sourcesCount: number;
}

export interface Dossier {
  id: string;
  topicId: string;
  title: string;
  notes: string;
  facts: string;
  sources: string;
  sourceRecords?: ResearchSource[];
  approved: boolean;
  updatedAt: string;
}

export interface ResearchSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  retrievedAt: string;
  pinpoint: string;
  status: 'unreviewed' | 'supports' | 'contradicts' | 'context';
  note: string;
  relatedClaims: string[];
}

export interface PodcastScript {
  id: string;
  dossierId: string;
  title: string;
  text: string;
  updatedAt: string;
}

/** Shared episode record linking the editorial workflow to future production work. */
export interface Episode {
  id: string;
  title: string;
  topicId: string;
  dossierId: string | null;
  scriptIds: string[];
  status: 'planning' | 'research' | 'script' | 'production' | 'complete';
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

const KEYS = {
  metrics: 'inside-verbrechen.metrics.v1',
  transcripts: 'inside-verbrechen.transcripts.v1',
  profile: 'inside-verbrechen.style-profile.v1',
  topics: 'inside-verbrechen.topics.v1',
  dossiers: 'inside-verbrechen.dossiers.v1',
  scripts: 'inside-verbrechen.scripts.v1',
  settings: 'inside-verbrechen.settings.v1',
  episodes: 'inside-verbrechen.episodes.v1',
  episodeMigration: 'inside-verbrechen.episodes-migration.v1',
};

export interface AppSettings {
  neutralStyle: string;
  wordsPerMinute: number;
}

export interface TopicSuggestion {
  title: string;
  country: string;
  period: string;
  category: string;
  summary: string;
}

export function parseTopicSuggestion(text: string): TopicSuggestion | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  if (start >= 0) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const value = JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>;
          const title = value['title'] ?? value['caseName'] ?? value['fallname'];
          if (typeof title === 'string' && title.trim()) return { title: title.trim(), country: stringValue(value['country']), period: stringValue(value['period']), category: stringValue(value['category']), summary: stringValue(value['summary']) };
        } catch { break; }
      }
    }
  }
  const lines = cleaned.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const fields: Record<string, string> = {};
  const aliases: Record<string, string> = { fall: 'title', fallname: 'title', titel: 'title', casename: 'title', land: 'country', country: 'country', zeitraum: 'period', periode: 'period', period: 'period', kategorie: 'category', category: 'category', zusammenfassung: 'summary', kurzbeschreibung: 'summary', summary: 'summary', beschreibung: 'summary' };
  for (const line of lines) {
    const match = line.replace(/^[-*•]\s*/, '').match(/^(?:\*\*)?([^:*]{2,30})(?:\*\*)?\s*:\s*(.*)$/);
    if (!match) continue;
    const key = aliases[match[1].replace(/[^\p{L}]/gu, '').toLowerCase()];
    if (key) fields[key] = match[2].replace(/\*\*/g, '').trim();
  }
  const heading = lines.map(line => line.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').trim()).find(line => line && !/^(vorschlag|themenvorschlag|einzelvorschlag|fallidee|thema)$/i.test(line));
  // Models occasionally ignore the JSON-only instruction and return headings such as
  // "Empfehlung (1): Fallname". Keep only the actual case name in the form.
  const cleanTitle = (value: string) => value
    .replace(/^\s*(?:empfehlung|vorschlag|fallidee|themenvorschlag)\s*(?:\(\d+\))?\s*[:—–-]\s*/i, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = cleanTitle(fields['title'] || heading || '');
  if (!title) return null;
  const fieldPattern = /^(?:[-*•]\s*)?(?:\*\*)?(?:Fall|Fallname|Titel|Land|Country|Zeitraum|Periode|Kategorie|Category|Zusammenfassung|Kurzbeschreibung|Summary|Beschreibung)\s*:/i;
  const contentLines = lines.filter(line => !/^#{1,6}\s/.test(line) && !fieldPattern.test(line) && !/^\|?\s*(?:[-:| ]+)?\|?$/.test(line));
  const summary = (fields['summary'] || contentLines.join('\n')).replace(/^\*\*Zusammenfassung:\*\*\s*/i, '').split(/\n\s*\|/)[0].trim().slice(0, 1200);
  return { title, country: fields['country'] || '', period: fields['period'] || '', category: fields['category'] || '', summary };
}

function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }

export function parseCsv(input: string): { rows: EpisodeMetric[]; errors: string[] } {
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return { rows: [], errors: ['Die CSV braucht eine Kopfzeile und mindestens eine Datenzeile.'] };
  const delimiter = [',', ';', '\t'].sort((a, b) => (lines[0].split(b).length - 1) - (lines[0].split(a).length - 1))[0];
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let cell = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { cells.push(cell.trim()); cell = ''; }
      else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseLine(lines[0]).map(value => value.toLowerCase().replace(/[ _-]/g, ''));
  const find = (...keys: string[]) => headers.findIndex(header => keys.includes(header));
  const titleIndex = find('name', 'title', 'episodentitel', 'titel');
  const playsIndex = find('plays', 'downloads', 'wiedergaben');
  const streamsIndex = find('streams', 'stream');
  const audienceIndex = find('audiencesize', 'audience', 'hörer', 'hoerer');
  const dateIndex = find('releasedate', 'date', 'veröffentlichungsdatum', 'veroeffentlichungsdatum');
  if (titleIndex < 0) return { rows: [], errors: ['Keine Titelspalte gefunden. Erwartet wird z. B. name oder title.'] };
  const rows: EpisodeMetric[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, index) => {
    const values = parseLine(line);
    const title = values[titleIndex]?.trim();
    if (!title) { errors.push(`Zeile ${index + 2}: Episodentitel fehlt.`); return; }
    const numeric = (column: number, label: string) => {
      if (column < 0 || !values[column]) return 0;
      const value = Number(values[column].replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) { errors.push(`Zeile ${index + 2}: ${label} ist keine gültige positive Zahl.`); return 0; }
      return value;
    };
    rows.push({ title, plays: numeric(playsIndex, 'Plays'), streams: numeric(streamsIndex, 'Streams'), audienceSize: numeric(audienceIndex, 'Audience Size'), releaseDate: dateIndex < 0 ? '' : values[dateIndex] ?? '' });
  });
  return { rows, errors };
}

export function buildStyleProfile(transcripts: TranscriptReference[]): StyleProfile | null {
  const usable = transcripts.filter(item => item.text.trim().length >= 80);
  if (!usable.length) return null;
  const fullText = usable.map(item => item.text.trim()).join('\n\n');
  const sentences = fullText.split(/[.!?]+/).map(sentence => sentence.trim()).filter(Boolean);
  const words = fullText.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
  const paragraphs = fullText.split(/\n\s*\n/).filter(part => part.trim());
  const vocabulary = ['zunächst', 'doch', 'später', 'währenddessen', 'schließlich', 'gleichzeitig', 'inzwischen', 'allerdings', 'dennoch', 'damals'];
  const lower = fullText.toLocaleLowerCase('de');
  return {
    sourceCount: usable.length,
    sourceNames: usable.map(item => item.name),
    generatedAt: new Date().toISOString(),
    wordCount: words.length,
    averageSentenceWords: sentences.length ? Math.round(words.length / sentences.length) : 0,
    paragraphCount: paragraphs.length,
    openingExamples: usable.map(item => item.text.trim().split(/\n\s*\n/)[0].slice(0, 280)).slice(0, 3),
    transitionWords: vocabulary.filter(word => lower.includes(word)),
    notes: [
      `Analysiert wurden ${usable.length} importierte Transkript${usable.length === 1 ? '' : 'e'} mit zusammen ${words.length.toLocaleString('de-DE')} Wörtern.`,
      `Die Sätze umfassen im Mittel etwa ${Math.round(words.length / Math.max(sentences.length, 1))} Wörter.`,
      `Erfasste Absätze: ${paragraphs.length}. Beispielpassagen dienen als Orientierung und dürfen nicht wörtlich übernommen werden.`,
    ],
  };
}

export function calculateTopicScore(sourceCount: number): { score: number; note: string } {
  // URLs are user-entered and not verified; source quality therefore remains neutral too.
  // Historical genre fit, novelty, dramaturgy, and episode length are not derivable from the CSV.
  const weighted = 50 * 0.3 + 50 * 0.3 + 50 * 0.2 + 50 * 0.1 + 50 * 0.1;
  return {
    score: Math.round(weighted),
    note: `Vorläufige Einschätzung: alle fünf Kriterien stehen mangels geprüfter Fallanalyse neutral bei 50. ${sourceCount} URL(s) im Dossier eingetragen, aber nicht auf Qualität oder Belegkraft geprüft. Kein statistisches Erfolgsversprechen.`,
  };
}

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

function loadEpisodes(): Episode[] {
  const existing = read<Episode[]>(KEYS.episodes, []);
  if (existing.length || localStorage.getItem(KEYS.episodeMigration) === '1') return existing;

  // One-time, non-destructive migration: preserve existing topic/dossier/script ids.
  const topics = read<Topic[]>(KEYS.topics, []);
  const dossiers = read<Dossier[]>(KEYS.dossiers, []);
  const scripts = read<PodcastScript[]>(KEYS.scripts, []);
  const now = new Date().toISOString();
  const migrated = topics.map(topic => {
    const dossier = dossiers.find(item => item.topicId === topic.id);
    const scriptIds = dossier ? scripts.filter(item => item.dossierId === dossier.id).map(item => item.id) : [];
    return {
      id: `episode-${topic.id}`,
      title: topic.title,
      topicId: topic.id,
      dossierId: dossier?.id ?? null,
      scriptIds,
      status: (scriptIds.length ? 'script' : dossier ? 'research' : 'planning') as Episode['status'],
      createdAt: topic.createdAt || now,
      updatedAt: dossier?.updatedAt || topic.createdAt || now,
      schemaVersion: 1 as const,
    };
  });
  localStorage.setItem(KEYS.episodes, JSON.stringify(migrated));
  localStorage.setItem(KEYS.episodeMigration, '1');
  return migrated;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  readonly episodes = signal<Episode[]>(loadEpisodes());
  readonly metrics = signal<EpisodeMetric[]>(read<EpisodeMetric[]>(KEYS.metrics, []));
  readonly transcripts = signal<TranscriptReference[]>(read<TranscriptReference[]>(KEYS.transcripts, []));
  readonly profile = signal<StyleProfile | null>(read<StyleProfile | null>(KEYS.profile, null));
  readonly topics = signal<Topic[]>(read<Topic[]>(KEYS.topics, []));
  readonly dossiers = signal<Dossier[]>(read<Dossier[]>(KEYS.dossiers, []));
  readonly scripts = signal<PodcastScript[]>(read<PodcastScript[]>(KEYS.scripts, []));
  readonly settings = signal<AppSettings>(read<AppSettings>(KEYS.settings, { neutralStyle: 'Sachlich, ruhig und respektvoll. Chronologisch erzählen, Unsicherheiten klar benennen. Keine erfundenen Dialoge, Gedanken oder Details.', wordsPerMinute: 125 }));

  private save<T>(key: string, value: T, target: ReturnType<typeof signal<T>>): void {
    localStorage.setItem(key, JSON.stringify(value));
    target.set(value);
  }
  saveMetrics(value: EpisodeMetric[]): void { this.save(KEYS.metrics, value, this.metrics); }
  saveTranscripts(value: TranscriptReference[]): void { this.save(KEYS.transcripts, value, this.transcripts); }
  saveProfile(value: StyleProfile | null): void { this.save(KEYS.profile, value, this.profile); }
  saveTopics(value: Topic[]): void {
    this.save(KEYS.topics, value, this.topics);
    const now = new Date().toISOString();
    const byTopic = new Map(this.episodes().map(episode => [episode.topicId, episode]));
    const episodes = value.map(topic => {
      const old = byTopic.get(topic.id);
      const dossier = this.dossiers().find(item => item.topicId === topic.id);
      const scripts = dossier ? this.scripts().filter(item => item.dossierId === dossier.id) : [];
      return old ? { ...old, title: topic.title, updatedAt: now } : {
        id: `episode-${topic.id}`, title: topic.title, topicId: topic.id,
        dossierId: dossier?.id ?? null, scriptIds: scripts.map(item => item.id),
        status: (scripts.length ? 'script' : dossier ? 'research' : 'planning') as Episode['status'],
        createdAt: topic.createdAt || now, updatedAt: now, schemaVersion: 1 as const,
      };
    });
    this.save(KEYS.episodes, episodes, this.episodes);
  }
  saveDossiers(value: Dossier[]): void {
    this.save(KEYS.dossiers, value, this.dossiers);
    const episodes = this.episodes().filter(episode => this.topics().some(topic => topic.id === episode.topicId)).map(episode => {
      const dossier = value.find(item => item.topicId === episode.topicId);
      const scripts = dossier ? this.scripts().filter(item => item.dossierId === dossier.id) : [];
      return { ...episode, dossierId: dossier?.id ?? null, scriptIds: scripts.map(item => item.id), status: (scripts.length ? 'script' : dossier ? 'research' : 'planning') as Episode['status'], updatedAt: dossier?.updatedAt ?? episode.updatedAt };
    });
    this.save(KEYS.episodes, episodes, this.episodes);
  }
  saveScripts(value: PodcastScript[]): void {
    this.save(KEYS.scripts, value, this.scripts);
    const episodes = this.episodes().map(episode => {
      const scripts = episode.dossierId ? value.filter(item => item.dossierId === episode.dossierId) : [];
      return { ...episode, scriptIds: scripts.map(item => item.id), status: (scripts.length ? 'script' : episode.dossierId ? 'research' : 'planning') as Episode['status'] };
    });
    this.save(KEYS.episodes, episodes, this.episodes);
  }
  saveSettings(value: AppSettings): void { this.save(KEYS.settings, value, this.settings); }
}
