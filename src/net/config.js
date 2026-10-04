// Online play configuration.
// Paste your Supabase project's URL and *anon public* key here (Project Settings → API).
// The anon key is meant to be public; row-level security in supabase/schema.sql protects the data.
// Leave them empty to run in local test mode (guest names, lobbies only between tabs of one browser).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// Public STUN servers for WebRTC peer-to-peer connections between players.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export const MAX_PLAYERS = 10;
export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 30;
