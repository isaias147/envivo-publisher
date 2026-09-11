// ⚠️ SOLO SERVIDOR. Código de verificación por correo, vía Mailgun.
//
// El canal `email` NO usa Twilio Verify (Verify solo admite SendGrid como
// integración de correo). Acá generamos el código, lo guardamos hasheado en
// `codigos_correo` y lo mandamos con Mailgun. El SMS sigue en Twilio: ese es
// el canal de autenticación real del publicador. Este correo solo confirma
// que la dirección existe y es suya, para poder comunicarnos después.

import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { supabaseServidor } from "@/lib/supabaseServidor";

const MG_KEY = process.env.MAILGUN_API_KEY || "";
const MG_DOMAIN = process.env.MAILGUN_DOMAIN || "";
const MG_BASE = process.env.MAILGUN_API_BASE || "https://api.mailgun.net";
const MG_FROM = process.env.MAILGUN_FROM || "";
const SECRETO = process.env.CODIGO_CORREO_SECRET || "";

const LARGO = 4;              // igual que LARGO_CODIGO de Twilio
const VIGENCIA_MIN = 10;      // el código vive 10 minutos
const MAX_INTENTOS = 5;       // tope de intentos por código
const MAX_ENVIOS = 3;         // tope de códigos pedidos...
const VENTANA_ENVIOS_MIN = 15; // ...en esta ventana

type Resultado =
  | { ok: true }
  | { ok: false; error: string; status: number };

/** HMAC del código atado al correo: la tabla nunca guarda el código en claro. */
function hashCodigo(correo: string, codigo: string): string {
  return createHmac("sha256", SECRETO)
    .update(`${correo}:${codigo}`)
    .digest("hex");
}

function comparaSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** POST al endpoint de mensajes de Mailgun. Basic auth con usuario "api". */
async function enviarPorMailgun(
  correo: string,
  codigo: string,
): Promise<Resultado> {
  if (!MG_KEY || !MG_DOMAIN || !MG_FROM) {
    return {
      ok: false,
      error: "Falta configurar el correo en el servidor.",
      status: 500,
    };
  }

  const auth = Buffer.from(`api:${MG_KEY}`).toString("base64");
  const campos = new URLSearchParams({
    from: MG_FROM,
    to: correo,
    subject: `Tu código de EnVivo: ${codigo}`,
    text:
      `Tu código para verificar el correo en EnVivo es ${codigo}.\n\n` +
      `Vence en ${VIGENCIA_MIN} minutos. Si no lo pediste, ignora este mensaje.`,
  });

  let respuesta: Response;
  try {
    respuesta = await fetch(`${MG_BASE}/v3/${MG_DOMAIN}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: campos.toString(),
    });
  } catch {
    return {
      ok: false,
      error: "No se pudo enviar el correo. Prueba de nuevo.",
      status: 502,
    };
  }

  if (!respuesta.ok) {
    return {
      ok: false,
      error: "No se pudo enviar el correo. Revisa la dirección.",
      status: respuesta.status === 429 ? 429 : 400,
    };
  }
  return { ok: true };
}

/** Genera, guarda y manda un código de 4 dígitos al correo. */
export async function enviarCodigoCorreo(correo: string): Promise<Resultado> {
  if (!SECRETO) {
    return {
      ok: false,
      error: "Falta configurar el correo en el servidor.",
      status: 500,
    };
  }

  const desde = new Date(
    Date.now() - VENTANA_ENVIOS_MIN * 60 * 1000,
  ).toISOString();
  const { count } = await supabaseServidor
    .from("codigos_correo")
    .select("id", { count: "exact", head: true })
    .eq("correo", correo)
    .gte("creado_en", desde);

  if ((count ?? 0) >= MAX_ENVIOS) {
    return {
      ok: false,
      error: "Pediste demasiados códigos. Espera un rato e intenta de nuevo.",
      status: 429,
    };
  }

  const codigo = String(randomInt(0, 10 ** LARGO)).padStart(LARGO, "0");
  const expira = new Date(Date.now() + VIGENCIA_MIN * 60 * 1000).toISOString();

  const { data: fila, error } = await supabaseServidor
    .from("codigos_correo")
    .insert({
      correo,
      codigo_hash: hashCodigo(correo, codigo),
      expira_en: expira,
    })
    .select("id")
    .single();

  if (error || !fila) {
    return { ok: false, error: "No se pudo generar el código.", status: 500 };
  }

  const envio = await enviarPorMailgun(correo, codigo);
  if (!envio.ok) {
    // El correo no salió: quemamos el código para que no quede vivo.
    await supabaseServidor
      .from("codigos_correo")
      .update({ consumido_en: new Date().toISOString() })
      .eq("id", fila.id);
    return envio;
  }

  return { ok: true };
}

/** Valida el código contra el último vigente para ese correo. */
export async function comprobarCodigoCorreo(
  correo: string,
  codigoCrudo: string,
): Promise<Resultado> {
  const codigo = String(codigoCrudo ?? "").replace(/\D/g, "");
  if (!SECRETO || codigo.length !== LARGO) {
    return { ok: false, error: "Escribe el código completo.", status: 400 };
  }

  const { data: fila } = await supabaseServidor
    .from("codigos_correo")
    .select("id, codigo_hash, intentos")
    .eq("correo", correo)
    .is("consumido_en", null)
    .gt("expira_en", new Date().toISOString())
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fila) {
    return { ok: false, error: "El código venció. Pide uno nuevo.", status: 401 };
  }

  if (fila.intentos >= MAX_INTENTOS) {
    return {
      ok: false,
      error: "Demasiados intentos con este código. Pide uno nuevo.",
      status: 429,
    };
  }

  if (!comparaSegura(fila.codigo_hash, hashCodigo(correo, codigo))) {
    await supabaseServidor
      .from("codigos_correo")
      .update({ intentos: fila.intentos + 1 })
      .eq("id", fila.id);
    return { ok: false, error: "El código no coincide o venció.", status: 401 };
  }

  await supabaseServidor
    .from("codigos_correo")
    .update({ consumido_en: new Date().toISOString() })
    .eq("id", fila.id);

  return { ok: true };
}
