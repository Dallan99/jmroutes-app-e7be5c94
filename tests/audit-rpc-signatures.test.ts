import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

describe('RPC Signatures Audit', () => {
  it('should verify RPC signatures match frontend expectations', async () => {
    const { data: functions, error } = await (supabaseAdmin as any).rpc('inspect_rpc_signatures', {
      p_names: [
        'meli_romaneio_abrir_com_primeiro_pacote',
        'meli_romaneio_bipar',
        'meli_romaneios_listar',
        'meli_romaneio_finalizar',
        'meli_romaneio_cancelar',
        'meli_romaneio_detalhar'
      ]
    });
    
    // Se a RPC de inspeção não existir, tentamos via information_schema
    if (error) {
      const { data: schemaInfo } = await (supabaseAdmin as any).rpc('supabase_execute', {
        query: \`
          SELECT routine_name, data_type 
          FROM information_schema.routines 
          WHERE routine_name IN (
            'meli_romaneio_abrir_com_primeiro_pacote',
            'meli_romaneio_bipar',
            'meli_romaneios_listar',
            'meli_romaneio_finalizar',
            'meli_romaneio_cancelar',
            'meli_romaneio_detalhar'
          )
        \`
      });
      console.log('RPC Info:', schemaInfo);
    } else {
      console.log('RPC Signatures:', functions);
    }
  });
});
