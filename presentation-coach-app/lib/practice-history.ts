import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type PracticeMode = 'qa' | 'filler' | 'paragraph' | 'topic';

export type PracticeHistoryEntry = {
  id: string;
  mode: PracticeMode;
  modeLabel: string;
  score: number;
  summary: string;
  detail?: string;
  created_at: string;
  metrics?: {
    preset?: string;
    wpm?: number;
    filler_count?: number;
    total_words?: number;
    verdict?: string;
  };
};

type PracticeHistoryInput = Omit<PracticeHistoryEntry, 'id' | 'created_at'> &
  Partial<Pick<PracticeHistoryEntry, 'id' | 'created_at'>>;

const STORAGE_KEY = 'speaksmart.practice.history.v1';
const MAX_HISTORY_ITEMS = 250;

const webStorage = {
  getItem: (key: string): Promise<string | null> => {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return Promise.resolve(localStorage.getItem(key));
  },
  setItem: (key: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return Promise.resolve();
    localStorage.setItem(key, value);
    return Promise.resolve();
  },
};

const storage = Platform.OS === 'web' ? webStorage : AsyncStorage;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeEntry(raw: any): PracticeHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  if (
    raw.mode !== 'qa' &&
    raw.mode !== 'filler' &&
    raw.mode !== 'paragraph' &&
    raw.mode !== 'topic'
  ) {
    return null;
  }
  if (typeof raw.modeLabel !== 'string' || typeof raw.summary !== 'string') {
    return null;
  }

  const id =
    typeof raw.id === 'string' && raw.id.trim().length > 0
      ? raw.id
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    mode: raw.mode,
    modeLabel: raw.modeLabel,
    score: clampScore(Number(raw.score ?? 0)),
    summary: raw.summary,
    detail: typeof raw.detail === 'string' ? raw.detail : undefined,
    created_at: toIsoString(raw.created_at),
    metrics: raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : undefined,
  };
}

async function writeEntries(entries: PracticeHistoryEntry[]): Promise<void> {
  await storage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export async function getPracticeHistoryEntries(): Promise<PracticeHistoryEntry[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeEntry)
      .filter((entry): entry is PracticeHistoryEntry => Boolean(entry))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  } catch {
    return [];
  }
}

export async function addPracticeHistoryEntry(
  input: PracticeHistoryInput,
): Promise<PracticeHistoryEntry> {
  const normalized = normalizeEntry({
    ...input,
    id:
      typeof input.id === 'string' && input.id.trim().length > 0
        ? input.id
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: input.created_at ?? new Date().toISOString(),
  });

  if (!normalized) {
    throw new Error('Invalid practice history entry');
  }

  const current = await getPracticeHistoryEntries();
  const next = [normalized, ...current].slice(0, MAX_HISTORY_ITEMS);
  await writeEntries(next);
  return normalized;
}
