-- The public schema is exposed through Supabase PostgREST. Application access
-- is server-only and uses service_role, which bypasses RLS. With no policies,
-- browser-facing anon/authenticated roles are denied by default.
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."category_subcategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."communication_localizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."communication_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."communication_subcategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."communication_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."communication_teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."communication_variables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."communication_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."communications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."favourites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."repository_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."subcategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sync_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."system_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;
