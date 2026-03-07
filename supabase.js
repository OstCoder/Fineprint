const FINEPRINT_CONFIG = window.FINEPRINT_CONFIG || {};
const SUPABASE_URL = FINEPRINT_CONFIG.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = FINEPRINT_CONFIG.SUPABASE_ANON_KEY || "";

const { createClient } = supabase;
const supabaseClient = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
