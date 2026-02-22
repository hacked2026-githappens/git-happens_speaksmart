import { supabase } from './supabase';

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
};

export async function saveSession(userId: string, data: SessionPayload) {
  return supabase.from('sessions').insert({ user_id: userId, ...data });
}

export async function fetchSessions(userId: string) {
  return supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}

export async function deleteSession(userId: string, sessionId: string) {
  return supabase
    .from('sessions')
    .delete()
    .eq('user_id', userId)
    .eq('id', sessionId);
}
