import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { buildStyleProfile, calculateTopicScore, parseCsv, parseTopicSuggestion, type TranscriptReference } from './workspace.store';

describe('workspace data functions', () => {
  it('parses quoted comma-separated episode statistics', () => {
    const result = parseCsv('"name","plays","streams","audience_size","releaseDate"\n"Case, Teil 1","42","31","28","2025-01-02"');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual({ title: 'Case, Teil 1', plays: 42, streams: 31, audienceSize: 28, releaseDate: '2025-01-02' });
  });

  it('reports a missing title column and malformed numeric values', () => {
    expect(parseCsv('plays;streams\n3;2').errors[0]).toContain('Keine Titelspalte');
    const result = parseCsv('title;plays\nEpisode;many');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].plays).toBe(0);
    expect(result.errors[0]).toContain('keine gültige');
  });

  it('builds a profile only from usable imported references', () => {
    const transcript: TranscriptReference = { id: '1', name: 'Folge.md', text: `Damals begann die Geschichte. Doch es gab offene Fragen.\n\nSpäter folgten neue Hinweise. ${'Wort '.repeat(20)}`, importedAt: '2026-01-01' };
    const profile = buildStyleProfile([transcript]);
    expect(profile?.sourceCount).toBe(1);
    expect(profile?.wordCount).toBeGreaterThan(20);
    expect(profile?.openingExamples[0]).toContain('Damals begann');
    expect(buildStyleProfile([{ ...transcript, text: 'zu kurz' }])).toBeNull();
  });

  it('keeps unsupported topic criteria neutral and labels uncertainty', () => {
    const result = calculateTopicScore(0);
    expect(result.score).toBe(50);
    expect(result.note).toContain('neutral');
    expect(result.note).toContain('Kein statistisches Erfolgsversprechen');
  });

  it('reads a single topic from JSON even when the model adds a Markdown heading', () => {
    const parsed = parseTopicSuggestion('### Ein Vorschlag\n```json\n{"title":"Ed Kemper","country":"USA","period":"1972–1973","category":"Serienmord","summary":"Quellenlage prüfen."}\n```');
    expect(parsed).toEqual({ title: 'Ed Kemper', country: 'USA', period: '1972–1973', category: 'Serienmord', summary: 'Quellenlage prüfen.' });
  });

  it('falls back to labeled Markdown fields for a topic suggestion', () => {
    const parsed = parseTopicSuggestion('### Einzelfall\n**Fallname:** Ed Kemper\n**Land:** USA\n**Zeitraum:** 1972–1973\n**Zusammenfassung:** Eine belegpflichtige Beschreibung.');
    expect(parsed?.title).toBe('Ed Kemper');
    expect(parsed?.country).toBe('USA');
    expect(parsed?.summary).toBe('Eine belegpflichtige Beschreibung.');
  });

  it('removes recommendation labels and does not treat scoring tables as case details', () => {
    const parsed = parseTopicSuggestion('### Empfehlung (1): Sechsfachmord von Hinterkaifeck\n**Zusammenfassung:** Sachliche Fallbeschreibung.\n| Kriterium | Gewicht | Note | Begründung |\n|---|---:|---:|---|\n| Quellenlage | 30 % | 5 | Staatliche Archive |');
    expect(parsed?.title).toBe('Sechsfachmord von Hinterkaifeck');
    expect(parsed?.country).toBe('');
    expect(parsed?.period).toBe('');
    expect(parsed?.category).toBe('');
    expect(parsed?.summary).toBe('Sachliche Fallbeschreibung.');
  });
});

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes)] }).compileComponents();
  });

  it('creates and renders the editorial workspace', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.componentInstance).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Guten Tag.');
  });
});
