-- 1) Tabelas Meli: remover qualquer privilégio de anon e de PUBLIC
REVOKE ALL ON TABLE public.meli_devolucoes FROM anon;
REVOKE ALL ON TABLE public.meli_devolucoes FROM PUBLIC;
REVOKE ALL ON TABLE public.meli_devolucoes_eventos FROM anon;
REVOKE ALL ON TABLE public.meli_devolucoes_eventos FROM PUBLIC;

-- authenticated: somente leitura (escrita apenas via RPCs SECURITY DEFINER)
REVOKE ALL ON TABLE public.meli_devolucoes FROM authenticated;
REVOKE ALL ON TABLE public.meli_devolucoes_eventos FROM authenticated;
GRANT SELECT ON TABLE public.meli_devolucoes TO authenticated;
GRANT SELECT ON TABLE public.meli_devolucoes_eventos TO authenticated;

-- service_role mantém acesso completo
GRANT ALL ON TABLE public.meli_devolucoes TO service_role;
GRANT ALL ON TABLE public.meli_devolucoes_eventos TO service_role;

-- 2) Funções Meli: revogar EXECUTE de anon e PUBLIC, manter authenticated/service_role
REVOKE ALL ON FUNCTION public.meli_rotas_area_risco(p_data date, p_base_id uuid, p_rota text, p_motorista text, p_transportadora text, p_risco text, p_status text) FROM anon;
REVOKE ALL ON FUNCTION public.meli_rotas_area_risco(p_data date, p_base_id uuid, p_rota text, p_motorista text, p_transportadora text, p_risco text, p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_rotas_area_risco(p_data date, p_base_id uuid, p_rota text, p_motorista text, p_transportadora text, p_risco text, p_status text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_devolucoes_sincronizar(p_data_de date, p_data_ate date, p_base_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.meli_devolucoes_sincronizar(p_data_de date, p_data_ate date, p_base_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(p_data_de date, p_data_ate date, p_base_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_devolucoes_painel(p_data_de date, p_data_ate date, p_base_id uuid, p_estado text, p_occurrence text, p_busca text) FROM anon;
REVOKE ALL ON FUNCTION public.meli_devolucoes_painel(p_data_de date, p_data_ate date, p_base_id uuid, p_estado text, p_occurrence text, p_busca text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_painel(p_data_de date, p_data_ate date, p_base_id uuid, p_estado text, p_occurrence text, p_busca text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_devolucao_receber(p_tracking text, p_base_id uuid, p_metodo text, p_observacao text) FROM anon;
REVOKE ALL ON FUNCTION public.meli_devolucao_receber(p_tracking text, p_base_id uuid, p_metodo text, p_observacao text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucao_receber(p_tracking text, p_base_id uuid, p_metodo text, p_observacao text) TO authenticated, service_role;

-- 3) DEFAULT PRIVILEGES da role proprietária das migrations (postgres):
--    novos objetos em public não devem conceder privilégios automáticos a anon.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;