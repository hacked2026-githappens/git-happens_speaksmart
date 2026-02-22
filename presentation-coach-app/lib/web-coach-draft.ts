const COACH_DRAFT_KEY = 'speaksmart-coach-analysis-draft-v1';
const COACH_SCROLL_KEY = 'speaksmart-coach-scroll-y-v1';

export type WebCoachDraft = {
  preset: 'general' | 'pitch' | 'classroom' | 'interview' | 'keynote';
  analysisTab?: 'report' | 'improvements' | 'transcript';
  feedback: unknown | null;
  followUpQuestion: string | null;
  answerFeedback: unknown | null;
  answerCorrectness: unknown | null;
  showContentPlan: boolean;
  showTranscript: boolean;
  answerShowTranscript: boolean;
  savedAt: number;
};

export function saveWebCoachDraft(
  draft: Omit<WebCoachDraft, 'savedAt'>,
): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  const payload: WebCoachDraft = {
    ...draft,
    savedAt: Date.now(),
  };
  window.localStorage.setItem(COACH_DRAFT_KEY, JSON.stringify(payload));
}

export function loadWebCoachDraft(): WebCoachDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  const raw = window.localStorage.getItem(COACH_DRAFT_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as WebCoachDraft;
  } catch {
    return null;
  }
}

export function clearWebCoachDraft(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  window.localStorage.removeItem(COACH_DRAFT_KEY);
}

export function saveWebCoachScrollY(value: number): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  window.sessionStorage.setItem(COACH_SCROLL_KEY, String(Math.max(0, value)));
}

export function loadWebCoachScrollY(): number {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return 0;
  }

  const raw = window.sessionStorage.getItem(COACH_SCROLL_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}
