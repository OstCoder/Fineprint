const SUPABASE_URL = "https://revokqweejngeuqqggsr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJldm9rcXdlZWpuZ2V1cXFnZ3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MDQ4MzgsImV4cCI6MjA4ODQ4MDgzOH0.sR8qnJ2BnvzSXx9NLOBXVFlN3soBcz-CpA2HrbM5rog";

const { createClient } = supabase;
const supabaseClient = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
