import { supabase } from './supabase';

export type Annotation = {
  time: number;   // seconds
  label: string;
  message: string;
};

export type SessionPayload = {
  preset: string;

  duration_s?: number | null;
  wpm?: number | null;
  pace_label?: string | null;
  filler_count?: number | null;

  scores?: Record<string, number> | null;
  strengths?: string[] | null;
  improvements?: { title: string; detail: string; actionable_tip?: string }[] | null;
  transcript?: string | null;
  non_verbal?: Record<string, any> | null;

  // ✅ NEW: for annotated replay
  video_uri?: string | null;
  annotations?: Annotation[] | null;
};

export async function saveSession(userId: string, data: SessionPayload) {
  return supabase.from('sessions').insert({
    user_id: userId,
    ...data,
  });
}

export async function fetchSessions(userId: string) {
  return supabase
    .from('sessions')
    .select(
      `
      id,
      created_at,
      preset,
      duration_s,
      wpm,
      pace_label,
      filler_count,
      scores,
      strengths,
      improvements,
      transcript,
      non_verbal,
      video_uri,
      annotations
    `,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}
