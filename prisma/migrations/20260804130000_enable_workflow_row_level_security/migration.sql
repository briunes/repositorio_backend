-- The application accesses these tables only from the NestJS backend using a
-- server-side secret/service role. No direct browser policies are intentional.
ALTER TABLE public.release_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_collaborator_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_active_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.release_notes FROM anon, authenticated;
REVOKE ALL ON TABLE public.team_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.communication_collaborator_teams FROM anon, authenticated;
REVOKE ALL ON TABLE public.approval_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.approval_decisions FROM anon, authenticated;
REVOKE ALL ON TABLE public.deployments FROM anon, authenticated;
REVOKE ALL ON TABLE public.communication_active_versions FROM anon, authenticated;
REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;
REVOKE ALL ON TABLE public.outbox_events FROM anon, authenticated;
