REVOKE ALL ON TABLE public.meli_worker_execucoes FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.meli_worker_execucoes TO authenticated;