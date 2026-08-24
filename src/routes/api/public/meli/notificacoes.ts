import { createFileRoute } from "@tanstack/react-router";

const CLIENT_ID = 4330561201844861;
const TOPICS = new Set(["shipments", "flex-handshakes"]);

export const Route = createFileRoute("/api/public/meli/notificacoes")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, servico: "meli-notificacoes" }),
      POST: async ({ request }) => {
        try {
          const raw = await request.text();
          if (raw.length > 64_000) return Response.json({ ok: false }, { status: 413 });
          const payload = JSON.parse(raw) as Record<string, unknown>;
          const topic = typeof payload.topic === "string" ? payload.topic : "";
          const resource = typeof payload.resource === "string" ? payload.resource : "";
          const applicationId = Number(payload.application_id);
          if (!TOPICS.has(topic) || !resource.startsWith("/") || applicationId !== CLIENT_ID) {
            return Response.json({ ok: false }, { status: 400 });
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const notificationId = typeof payload._id === "string" ? payload._id : null;
          const { error } = await (supabaseAdmin as any).from("meli_api_notificacoes").upsert({
            notification_id: notificationId,
            topic,
            resource: resource.slice(0, 1000),
            meli_user_id: Number.isFinite(Number(payload.user_id)) ? Number(payload.user_id) : null,
            application_id: applicationId,
            payload,
          }, { onConflict: "notification_id", ignoreDuplicates: true });
          if (error) console.error("[meli-notificacoes]", error.message);
          return Response.json({ ok: true });
        } catch (error) {
          console.error("[meli-notificacoes]", error);
          return Response.json({ ok: true });
        }
      },
    },
  },
});
