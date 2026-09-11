// ⚠️ SOLO SERVIDOR. Cookies firmadas del lado del publicador.
//
// Misma técnica que lib/adminSesion.ts: un texto firmado con HMAC-SHA256 que
// el navegador no puede leer (HttpOnly) ni falsificar (no conoce el secreto).
// Hay dos cookies distintas:
//
//   envivo_registro   — provisional, dura 20 min. Lleva tipo + nombre +
//                       celular de cuenta (verificado por SMS, no es
//                       WhatsApp) mientras la persona pasa por
//                       /registro → /registro/verificar → /registro/perfil.
//                       El flag `verificado` lo pone /api/registro/verificar
//                       cuando Twilio Verify aprueba el código: es la única
//                       prueba de que el número quedó verificado (no hay
//                       fila en la base). Solo el servidor puede firmarlo.
//   envivo_publicador — la sesión de verdad (30 días), ya con perfil creado.
//                       Da acceso a /panel.
//
// El secreto es la service_role key (o ADMIN_SESSION_SECRET si se define
// aparte), igual que la sesión del panel de admin.

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { TipoPerfil } from "@/lib/tiposPerfil";

export const COOKIE_REGISTRO = "envivo_registro";
export const COOKIE_PUBLICADOR = "envivo_publicador";

const REGISTRO_MIN = 20;
const SESION_DIAS = 30;

const secreto =
  process.env.ADMIN_SESSION_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

if (!secreto) {
  throw new Error(
    "Falta SUPABASE_SERVICE_ROLE_KEY (o ADMIN_SESSION_SECRET) para firmar las sesiones del publicador",
  );
}

// `TipoPerfil` vive en `lib/tiposPerfil.ts` (sin deps de servidor). Se
// re-exporta por compatibilidad con quien lo importaba desde aquí.
export type { TipoPerfil } from "@/lib/tiposPerfil";

export type DatosRegistro = {
  tipo: TipoPerfil;
  nombre: string;
  celular: string; // celular de cuenta, verificado por SMS (NO es WhatsApp); indicativo + dígitos, ya normalizado
  correo: string;
  adminNombre: string;
  adminApellido: string;
  adminEdad: number;
  userId: string; // auth.users.id de Google, tomado de auth.getUser() en /api/registro/iniciar
  smsOk?: boolean; // Twilio Verify aprobó el código del SMS
  correoOk?: boolean; // …y el del correo. Ambos hacen falta para seguir.
  exp: number; // epoch en segundos
};

export type SesionPublicador = {
  perfilId: string;
  nombre: string | null;
  celular: string; // celular de cuenta, verificado por SMS (NO es WhatsApp)
  exp: number;
};

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function desde64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function firmar(carga: string): string {
  return base64url(createHmac("sha256", secreto).update(carga).digest());
}

function empaquetar(datos: object): string {
  const carga = base64url(Buffer.from(JSON.stringify(datos), "utf8"));
  return `${carga}.${firmar(carga)}`;
}

function desempaquetar<T extends { exp?: number }>(
  token: string | undefined,
): T | null {
  if (!token) return null;
  const punto = token.lastIndexOf(".");
  if (punto < 1) return null;

  const carga = token.slice(0, punto);
  const firma = token.slice(punto + 1);

  const a = Buffer.from(firma);
  const b = Buffer.from(firmar(carga));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const datos = JSON.parse(desde64url(carga).toString("utf8")) as T;
    if (typeof datos.exp !== "number" || datos.exp * 1000 < Date.now()) {
      return null;
    }
    return datos;
  } catch {
    return null;
  }
}

// ---------- envivo_registro (provisional) ----------

export function crearTokenRegistro(d: Omit<DatosRegistro, "exp">): {
  token: string;
  maxAge: number;
} {
  const maxAge = REGISTRO_MIN * 60;
  const datos: DatosRegistro = {
    ...d,
    exp: Math.floor(Date.now() / 1000) + maxAge,
  };
  return { token: empaquetar(datos), maxAge };
}

export function verificarTokenRegistro(
  token: string | undefined,
): DatosRegistro | null {
  const d = desempaquetar<DatosRegistro>(token);
  if (!d || !d.tipo || !d.celular || !d.correo || !d.userId) return null;
  return d;
}

/** Lee la cookie provisional de la petición actual. */
export async function leerRegistro(): Promise<DatosRegistro | null> {
  const tarro = await cookies();
  return verificarTokenRegistro(tarro.get(COOKIE_REGISTRO)?.value);
}

// ---------- envivo_publicador (sesión) ----------

export function crearTokenPublicador(
  perfilId: string,
  nombre: string | null,
  celular: string,
): { token: string; maxAge: number } {
  const maxAge = SESION_DIAS * 24 * 3600;
  const datos: SesionPublicador = {
    perfilId,
    nombre,
    celular,
    exp: Math.floor(Date.now() / 1000) + maxAge,
  };
  return { token: empaquetar(datos), maxAge };
}

export function verificarTokenPublicador(
  token: string | undefined,
): SesionPublicador | null {
  const d = desempaquetar<SesionPublicador>(token);
  if (!d || !d.perfilId) return null;
  return d;
}

/**
 * Lee la cookie de sesión del publicador. Úsala al principio de /panel y de
 * las API routes que exijan estar registrado.
 */
export async function leerSesionPublicador(): Promise<SesionPublicador | null> {
  const tarro = await cookies();
  return verificarTokenPublicador(tarro.get(COOKIE_PUBLICADOR)?.value);
}
