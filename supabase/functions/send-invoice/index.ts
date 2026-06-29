// ============================================================================
// send-invoice — emails an Ascora Studio invoice (PDF attachment) via Resend.
//
// Security: requires a valid admin JWT. The caller's token is forwarded to
// Supabase and is_admin() is checked before anything is sent; the invoice is
// read under the caller's RLS context (admin-only), so non-admins get nothing.
//
// One-time setup:
//   supabase secrets set RESEND_API_KEY=re_xxx
//   (optional) supabase secrets set RESEND_FROM="Ascora Studio <invoices@ascorastudio.com>"
//   supabase functions deploy send-invoice
// Until a domain is verified in Resend, the default sender onboarding@resend.dev
// can only deliver to the Resend account owner's address (fine for testing).
// ============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Gate: caller must be an admin.
    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_admin");
    if (adminErr || !isAdmin) return json({ error: "Not authorized" }, 403);

    const body = await req.json().catch(() => ({}));
    const { invoice_id, to, subject, message, pdf_base64 } = body || {};
    if (!invoice_id || !to) return json({ error: "invoice_id and recipient are required" }, 400);

    // Read under the caller's RLS (admin-only table).
    const { data: inv, error: invErr } = await userClient
      .from("invoices").select("*").eq("id", invoice_id).single();
    if (invErr || !inv) return json({ error: "Invoice not found" }, 404);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return json({ error: "Email is not configured. Add RESEND_API_KEY as a Supabase secret." }, 500);
    }
    const FROM = Deno.env.get("RESEND_FROM") ||
      `${inv.biz_brand_name || "Ascora Studio"} <onboarding@resend.dev>`;

    const payload: Record<string, unknown> = {
      from: FROM,
      to: [to],
      subject: subject || `Invoice ${inv.number}`,
      html: buildHtml(inv, message),
      reply_to: inv.biz_email || undefined,
    };
    if (pdf_base64) {
      payload.attachments = [{ filename: `${inv.number}.pdf`, content: pdf_base64 }];
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: out?.message || "Email provider error", detail: out }, 502);

    // Advance draft -> sent on first send.
    if (inv.status === "draft") {
      await userClient.from("invoices").update({ status: "sent" }).eq("id", invoice_id);
    }
    return json({ ok: true, id: out?.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
function money(n: unknown, c?: string): string {
  try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: c || "EUR" }).format(Number(n || 0)); }
  catch (_) { return `${c || "EUR"} ${Number(n || 0).toFixed(2)}`; }
}
function buildHtml(inv: Record<string, any>, message?: string): string {
  const msg = esc(message || "").replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#15171d">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7e9f0;border-radius:14px;overflow:hidden">
    <div style="height:5px;background:linear-gradient(90deg,#4d7cff,#7a5cff)"></div>
    <div style="padding:28px 30px">
      <div style="font-weight:700;font-size:20px;letter-spacing:-0.5px">${esc(inv.biz_brand_name || "Ascora Studio")}</div>
      <div style="color:#6a7180;font-size:13px;margin-bottom:18px">${esc(inv.biz_legal_name || "")}</div>
      <div style="font-size:14px;line-height:1.65;color:#3a3f4a">${msg}</div>
      <div style="margin:22px 0;padding:16px 18px;background:#f7f8fb;border:1px solid #e7e9f0;border-radius:10px">
        <div style="font-size:12px;color:#6a7180;font-family:monospace;letter-spacing:1px">INVOICE ${esc(inv.number)}</div>
        <div style="font-size:22px;font-weight:700;margin-top:6px">${money(inv.total, inv.currency)}</div>
        <div style="font-size:12px;color:#6a7180;margin-top:4px">Balance due ${money(inv.balance_due, inv.currency)} · Reference ${esc(inv.number)}</div>
      </div>
      <div style="font-size:12px;color:#9aa0ad;margin-top:18px">${esc(inv.footer_text || "")}</div>
    </div>
  </div></body></html>`;
}
