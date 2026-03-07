const SUPABASE_ANON_KEY = window.FINEPRINT_CONFIG.SUPABASE_ANON_KEY;
const SUPABASE_URL = window.FINEPRINT_CONFIG.SUPABASE_URL;

const { createClient } = supabase;
const supabaseClient = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
