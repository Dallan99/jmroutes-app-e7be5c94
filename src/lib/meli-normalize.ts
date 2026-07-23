// Normalização de payloads do endpoint route-detail do Mercado Livre
// para o formato aceito pela RPC meli_importar_rota.

export type PacoteNormalizado = {
  tracking_id: string;
  shipment_id: string | null;
  destinatario: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  status: string | null;
  printed_label: string | null;
  ordem: number | null;
};

export type PayloadNormalizado = {
  route_id: string;
  cluster: string | null;
  carrier: string | null;
  facility: string | null;
  data_rota: string | null;
  status: string | null;
  substatus: string | null;
  pacotes: PacoteNormalizado[];
};

export type ResumoNormalizacao = {
  route_id: string;
  cluster: string | null;
  facility: string | null;
  total_paradas: number;
  total_extraidos: number;
  total_informado: number | null;
  diferenca: number | null;
  descartados_sem_tracking: number;
  duplicados_removidos: number;
};

type AnyRec = Record<string, unknown>;

function asRec(v: unknown): AnyRec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRec) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function s(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}
function unixParaData(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    // pode já vir como string ISO
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return null;
  }
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Detecta se o payload já está no formato normalizado (com route_id/meli_route_id + pacotes[]). */
export function jaNormalizado(payload: AnyRec): boolean {
  const temRouteId = "route_id" in payload || "meli_route_id" in payload;
  const temPacotes = Array.isArray((payload as AnyRec).pacotes);
  const temStops = Array.isArray((payload as AnyRec).stops);
  return temRouteId && temPacotes && !temStops;
}

export function normalizarPayloadMeli(payloadInput: AnyRec): {
  payload: PayloadNormalizado;
  resumo: ResumoNormalizacao;
} {
  // Se já veio normalizado, apenas retorna com resumo calculado.
  if (jaNormalizado(payloadInput)) {
    const p = payloadInput as AnyRec;
    const pacotes = asArr(p.pacotes).map((pk) => {
      const r = asRec(pk);
      return {
        tracking_id: s(r.tracking_id) ?? "",
        shipment_id: s(r.shipment_id),
        destinatario: s(r.destinatario),
        endereco: s(r.endereco),
        bairro: s(r.bairro),
        cidade: s(r.cidade),
        uf: s(r.uf),
        cep: s(r.cep),
        status: s(r.status),
        printed_label: s(r.printed_label),
        ordem: typeof r.ordem === "number" && Number.isInteger(r.ordem) ? r.ordem : null,
      } as PacoteNormalizado;
    });
    const semTracking = pacotes.filter((x) => !x.tracking_id).length;
    const validos = pacotes.filter((x) => x.tracking_id);
    const dedup = new Map<string, PacoteNormalizado>();
    for (const pk of validos) dedup.set(pk.tracking_id, pk);
    const finais = Array.from(dedup.values());

    const routeId = s(p.route_id) ?? s(p.meli_route_id) ?? "";
    return {
      payload: {
        route_id: routeId,
        cluster: s(p.cluster),
        carrier: s(p.carrier),
        facility: s(p.facility),
        data_rota: s(p.data_rota),
        status: s(p.status),
        substatus: s(p.substatus),
        pacotes: finais,
      },
      resumo: {
        route_id: routeId,
        cluster: s(p.cluster),
        facility: s(p.facility),
        total_paradas: 0,
        total_extraidos: finais.length,
        total_informado: null,
        diferenca: null,
        descartados_sem_tracking: semTracking,
        duplicados_removidos: validos.length - finais.length,
      },
    };
  }

  // Formato bruto do route-detail do Meli.
  const stops = asArr(payloadInput.stops);
  const brutos: PacoteNormalizado[] = [];

  for (const stopRaw of stops) {
    const stop = asRec(stopRaw);
    const ordem =
      typeof stop.sequence === "number" && Number.isInteger(stop.sequence)
        ? (stop.sequence as number)
        : null;
    for (const orderRaw of asArr(stop.orders)) {
      const order = asRec(orderRaw);
      for (const unitRaw of asArr(order.transportUnits)) {
        const unit = asRec(unitRaw);
        const entity = asRec(unit.relatedEntity);
        const receiver = asRec(entity.receiverInfo ?? entity.receiver_info);
        const entityId = entity.id ?? null;
        const shipmentId = entityId ?? receiver.shipment_id ?? null;

        const endereco =
          [s(receiver.street_name), s(receiver.street_number)]
            .filter((x): x is string => !!x)
            .join(", ") || null;

        brutos.push({
          tracking_id: s(entityId) ?? s(receiver.shipment_id) ?? "",
          shipment_id: s(shipmentId),
          destinatario: s(receiver.receiver_name),
          endereco,
          bairro: s(receiver.neighborhood),
          cidade: s(receiver.city),
          uf: s(receiver.state),
          cep: s(receiver.zip_code),
          status:
            s(entity.substatus) ??
            s(unit.frontStatus) ??
            s(unit.status) ??
            s(entity.status),
          printed_label: s(unit.printedLabel),
          ordem,
        });
      }
    }
  }

  const semTracking = brutos.filter((x) => !x.tracking_id).length;
  const validos = brutos.filter((x) => x.tracking_id);
  const dedup = new Map<string, PacoteNormalizado>();
  for (const pk of validos) dedup.set(pk.tracking_id, pk); // mantém última ocorrência
  const finais = Array.from(dedup.values());

  const counters = asRec(payloadInput.counters);
  const totalInformado =
    typeof counters.totalShipments === "number"
      ? (counters.totalShipments as number)
      : counters.totalShipments != null && Number.isFinite(Number(counters.totalShipments))
        ? Number(counters.totalShipments)
        : null;

  const routeId = s(payloadInput.id) ?? "";
  const cluster = s(payloadInput.cluster);
  const facility = s(payloadInput.serviceCenterId);

  return {
    payload: {
      route_id: routeId,
      cluster,
      carrier: s(payloadInput.carrier),
      facility,
      data_rota: unixParaData(payloadInput.initDate),
      status: s(payloadInput.status),
      substatus: s(payloadInput.substatus),
      pacotes: finais,
    },
    resumo: {
      route_id: routeId,
      cluster,
      facility,
      total_paradas: stops.length,
      total_extraidos: finais.length,
      total_informado: totalInformado,
      diferenca: totalInformado != null ? finais.length - totalInformado : null,
      descartados_sem_tracking: semTracking,
      duplicados_removidos: validos.length - finais.length,
    },
  };
}
