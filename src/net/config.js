// Online play configuration.
// Paste your Supabase project's URL and *anon public* key here (Project Settings → API).
// The anon key is meant to be public; row-level security in supabase/schema.sql protects the data.
// Leave them empty to run in local test mode (guest names, lobbies only between tabs of one browser).
export const SUPABASE_URL = 'https://qntbzqupetqssyodixcj.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFudGJ6cXVwZXRxc3N5b2RpeGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMTI4NjQsImV4cCI6MjEwNjY4ODg2NH0.GJC2QsvXWChtGEQ01y-WQV0vBFfCNRB0nOnPHwLWIHQ';

// Public STUN servers for WebRTC peer-to-peer connections between players.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export const MAX_PLAYERS = 10;
export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 30;
