// Shared Supabase project + anon-key constants. The browser is allowed to
// see the anon key (it's the same key Supabase prints in the dashboard's
// "Project API keys" panel under "anon public"); row access still goes
// through Edge Functions that validate the HMAC token from auth.js.

export const SB_URL  = "https://flmvxigozjuizpckllvk.supabase.co";
export const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsbXZ4aWdvemp1aXpwY2tsbHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODM3MjgsImV4cCI6MjA5MjM1OTcyOH0.vFqe6PNsPbVkg7NJmQJBsVECX1S58vAvv5MOjf63Xck";

export const EDGE_AUTH_URL = `${SB_URL}/functions/v1/auth`;
export const EDGE_DATA_URL = `${SB_URL}/functions/v1/data`;
