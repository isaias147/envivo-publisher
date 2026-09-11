// ⚠️ SOLO SERVIDOR. Alta y verificación del publicador (Twilio Verify).
//
// Usa `supabaseServidor` (service_role) sobre la tabla `perfiles` de la
// Sesión 11. Nunca se importa desde el cliente.
//
// Verificación: **dos canales obligatorios**, SMS y correo, ambos por Twilio
// Verify (el canal `email` necesita SendGrid conectado al servicio de Verify
// en la consola de Twilio). Acá solo hay llamadas HTTP a su API:
// `iniciarVerificacion(destino, canal)` (que manden el código) y
// `comprobarCodigo(destino, codigo, canal)` (validarlo). La "verdad" de qué
// canal quedó verificado NO vive en la base durante el alta: vive en la
// cookie firmada `envivo_registro` (flags `smsOk` / `correoOk`, que solo
// pone el servidor). El `perfiles` se crea recién al final
// (/api/registro/perfil), y ahí sí queda `correo_verificado`.

import "server-only";

import { supabaseServidor } from "@/lib/supabaseServidor";
import { comprobarCodigoCorreo, enviarCodigoCorreo } from "@/lib/codigoCorreo";
import { normalizarWhatsapp } from "@/lib/eventos";
import type { TipoPerfil } from "@/lib/tiposPerfil";

// `TipoPerfil`, `TIPOS_PERFIL` y `esTipoPerfil` viven en `lib/tiposPerfil.ts`
// (sin dependencias de servidor) para que el Client Component `/registro`
// pueda importarlos sin arrastrar la service_role key de `supabaseServidor`.

// Candado de contacto: Instagram y WhatsApp público quedan bloqueados 30
// días desde el último cambio (`perfiles.ultimo_cambio_contacto`). El nombre
// no tiene candado. Lo calculan /perfil (para pintar) y la API de guardado
// (para validar server-side, sin confiar en el frontend).
export const VENTANA_CANDADO_DIAS = 30;

export function candadoContacto(ultimoCambio: string | null | undefined): {
  bloqueado: boolean;
  desbloqueaEn: string | null;
} {
  if (!ultimoCambio) return { bloqueado: false, desbloqueaEn: null };
  const desbloqueo = new Date(
    new Date(ultimoCambio).getTime() +
      VENTANA_CANDADO_DIAS * 24 * 60 * 60 * 1000,
  );
  return {
    bloqueado: desbloqueo.getTime() > Date.now(),
    desbloqueaEn: desbloqueo.toISOString(),
  };
}

// Largo del código que manda Twilio Verify. El servicio de Verify tiene que
// estar configurado en la consola de Twilio con "Code Length = 4" para que
// coincida con las 4 casillas de /registro/verificar.
export const LARGO_CODIGO = 6;

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_SERVICE = process.env.TWILIO_VERIFY_SERVICE_SID || "";

export type ResultadoVerificacion =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Una llamada POST a la API de Twilio Verify. `recurso` es "Verifications"
 * (mandar el SMS) o "VerificationCheck" (comprobar el código). Autentica con
 * Basic auth (AccountSid:AuthToken) y manda los campos como formulario, que
 * es lo que espera Twilio. Devuelve el `status` que reporta Twilio
 * ("pending" / "approved" / "canceled" …).
 */
async function llamarTwilio(
  recurso: "Verifications" | "VerificationCheck",
  campos: Record<string, string>,
): Promise<
  { ok: true; estado: string } | { ok: false; error: string; status: number }
> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_SERVICE) {
    return {
      ok: false,
      error: "Falta configurar Twilio Verify en el servidor.",
      status: 500,
    };
  }

  const url = `https://verify.twilio.com/v2/Services/${TWILIO_SERVICE}/${recurso}`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(campos).toString(),
    });
  } catch {
    return {
      ok: false,
      error: "No se pudo contactar el servicio de SMS. Prueba de nuevo.",
      status: 502,
    };
  }

  const cuerpo = (await respuesta.json().catch(() => null)) as
    | { status?: string; code?: number; message?: string }
    | null;

  if (!respuesta.ok) {
    return {
      ok: false,
      error: mensajeErrorTwilio(respuesta.status, cuerpo?.code),
      status: respuesta.status === 429 ? 429 : 400,
    };
  }

  return { ok: true, estado: String(cuerpo?.status ?? "") };
}

/** Traduce los errores más comunes de Twilio Verify a algo legible. */
function mensajeErrorTwilio(http: number, codigo?: number): string {
  if (http === 429 || codigo === 60203) {
    return "Pediste demasiados códigos. Espera un rato e intenta de nuevo.";
  }
  if (codigo === 60200) return "Ese dato no parece válido.";
  if (codigo === 60202) {
    return "Demasiados intentos con este código. Pide uno nuevo.";
  }
  if (http === 404) return "El código venció. Pide uno nuevo.";
  return "No se pudo verificar. Intenta de nuevo.";
}

export type Canal = "sms" | "email";

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function esCorreoValido(v: string | null | undefined): boolean {
  return RE_CORREO.test(String(v ?? "").trim());
}

/**
 * Formatea el destino para Twilio según el canal: SMS necesita E.164
 * (`+<dígitos>`); email va tal cual.
 */
function destinoTwilio(destinoCrudo: string, canal: Canal): string | null {
  if (canal === "email") {
    const correo = String(destinoCrudo ?? "").trim().toLowerCase();
    return esCorreoValido(correo) ? correo : null;
  }
  const celular = normalizarWhatsapp(destinoCrudo);
  return celular.length >= 8 ? `+${celular}` : null;
}

/**
 * Le pide a Twilio Verify que mande un código por `canal` ("sms" | "email").
 * Twilio se encarga de generarlo, de que expire y del tope de reenvíos.
 */
export async function iniciarVerificacion(
  destinoCrudo: string,
  canal: Canal = "sms",
): Promise<ResultadoVerificacion> {
  const to = destinoTwilio(destinoCrudo, canal);
  if (!to) {
    return {
      ok: false,
      error: canal === "email" ? "El correo no parece válido." : "El celular no parece válido.",
      status: 400,
    };
  }

  if (canal === "email") return enviarCodigoCorreo(to);

  const res = await llamarTwilio("Verifications", { To: to, Channel: canal });
  if (!res.ok) return res;
  return { ok: true };
}

/**
 * Le pasa a Twilio Verify el `codigo` que escribió el usuario para ese
 * destino y canal. `ok: true` solo si Twilio responde `status: "approved"`.
 */
export async function comprobarCodigo(
  destinoCrudo: string,
  codigoCrudo: string,
  canal: Canal = "sms",
): Promise<ResultadoVerificacion> {
  const to = destinoTwilio(destinoCrudo, canal);
  const codigo = String(codigoCrudo ?? "").replace(/\D/g, "");
  if (!to) {
    return { ok: false, error: "Escribe el código completo.", status: 400 };
  }

  // El correo usa su propio largo (4) y valida adentro; el SMS usa el de Twilio (6).
  if (canal === "email") return comprobarCodigoCorreo(to, codigo);

  if (codigo.length !== LARGO_CODIGO) {
    return { ok: false, error: "Escribe el código completo.", status: 400 };
  }

  const res = await llamarTwilio("VerificationCheck", { To: to, Code: codigo });
  if (!res.ok) return res;
  if (res.estado !== "approved") {
    return { ok: false, error: "El código no coincide o venció.", status: 401 };
  }
  return { ok: true };
}

/** "Salsa Viva" → "salsa-viva". Vacío → "perfil". */
export function slugDesde(nombre: string): string {
  const base = (nombre || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes y diéresis
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "perfil";
}

async function slugLibre(nombre: string): Promise<string> {
  const base = slugDesde(nombre);
  for (let i = 0; i < 12; i++) {
    const intento = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await supabaseServidor
      .from("perfiles")
      .select("id")
      .eq("slug", intento)
      .maybeSingle();
    if (!data) return intento;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export type DatosPerfil = {
  tipo: TipoPerfil;
  nombre: string;
  celular: string; // celular de cuenta, verificado por SMS (indicativo + dígitos)
  whatsappPublico: string;
  instagram: string | null;
  tiktok: string | null;
  imagenUrl: string | null;
  correo: string;
  adminNombre: string;
  adminApellido: string;
  adminEdad: number;
  userId: string; // auth.users.id de Google (perfiles.user_id, UNIQUE)
};

export type ResultadoPerfil =
  | { ok: true; perfilId: string; nombre: string | null }
  | { ok: false; error: string; status: number };

/**
 * Crea el `perfiles`. Nunca actualiza uno existente ni le reasigna el
 * user_id: si la cuenta de Google ya tiene perfil, o si el celular
 * (verificado por SMS) ya pertenece a otro perfil (con otro user_id, o con
 * user_id todavía null), responde 409 en vez de tocarlo. El chequeo de
 * "este número está verificado" lo hace la ruta que llama a esta función,
 * leyendo el flag de la cookie `envivo_registro`. Devuelve el id para armar
 * la sesión.
 */
export async function crearPerfil(
  d: DatosPerfil,
): Promise<ResultadoPerfil> {
  const celular = normalizarWhatsapp(d.celular);

  // Esta cuenta de Google ya tiene un perfil de publicador (perfiles.user_id
  // es UNIQUE): no se crea uno segundo con la misma cuenta.
  const { data: yaTienePerfil } = await supabaseServidor
    .from("perfiles")
    .select("id")
    .eq("user_id", d.userId)
    .maybeSingle();
  if (yaTienePerfil?.id) {
    return {
      ok: false,
      error: "Ya tienes un perfil como publicador.",
      status: 409,
    };
  }

  const campos = {
    tipo: d.tipo,
    nombre: d.nombre.trim() || null,
    whatsapp_publico: normalizarWhatsapp(d.whatsappPublico) || null,
    instagram: d.instagram?.trim() || null,
    tiktok: d.tiktok?.trim() || null,
    imagen_url: d.imagenUrl?.trim() || null,
    correo_admin: d.correo.trim().toLowerCase() || null,
    correo_verificado: true,
    admin_nombre: d.adminNombre.trim() || null,
    admin_apellido: d.adminApellido.trim() || null,
    admin_edad: Number.isFinite(d.adminEdad) ? d.adminEdad : null,
    verified_at: new Date().toISOString(),
    user_id: d.userId,
  };

  // Ya sabemos (chequeo de arriba) que ningún perfil tiene este user_id. Si
  // el celular ya pertenece a OTRO perfil (con otro user_id, o con
  // user_id null), ese perfil ya tiene o tuvo otro dueño: nunca se le
  // reasigna el user_id por acá. Se bloquea con 409 en vez de actualizarlo.
  const { data: existente } = await supabaseServidor
    .from("perfiles")
    .select("id")
    .eq("celular_cuenta", celular)
    .maybeSingle();

  if (existente?.id) {
    return {
      ok: false,
      error: "Ese celular ya tiene un perfil registrado.",
      status: 409,
    };
  }

  const { data: creado, error } = await supabaseServidor
    .from("perfiles")
    .insert({
      ...campos,
      celular_cuenta: celular,
      slug: await slugLibre(d.nombre),
    })
    .select("id, nombre")
    .single();

  if (error) {
    // 23505 = unique_violation: dos registros a la vez pasaron los chequeos
    // de arriba y llegaron juntos al insert. No es un error del servidor
    // (500): es la misma condición de negocio (409), solo detectada tarde.
    if (error.code === "23505") {
      const porUserId =
        error.message?.includes("user_id") || error.details?.includes("user_id");
      return {
        ok: false,
        error: porUserId
          ? "Ya tienes un perfil como publicador."
          : "Ese celular ya tiene un perfil registrado.",
        status: 409,
      };
    }
    return { ok: false, error: "No se pudo crear el perfil.", status: 500 };
  }
  if (!creado) {
    return { ok: false, error: "No se pudo crear el perfil.", status: 500 };
  }
  return { ok: true, perfilId: creado.id, nombre: creado.nombre ?? null };
}
