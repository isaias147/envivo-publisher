// POST /api/registro/perfil  { imagenUrl?, instagram?, tiktok?, indicativoPublico?, whatsappPublico? }
//   Authorization: Bearer <access_token de Google>
//
// Último paso del alta. Exige la cookie `envivo_registro` y que el número
// esté verificado. Además vuelve a validar la sesión de Google con
// auth.getUser() y exige que sea LA MISMA cuenta que inició el registro
// (reg.userId): si alguien arrancó /registro con una cuenta y llega hasta
// acá con otra (sesión cambiada a medio camino), se corta y se borra la
// cookie provisional, en vez de crear el perfil con un userId que ya no es
// el de quien está pidiendo esto. Crea el `perfiles`, deja el
// `access_token` de /mis-eventos, cambia la cookie provisional por la
// sesión real `envivo_publicador` y responde con el destino (/, el mapa:
// /panel todavía es un placeholder vacío de la Sesión 15).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { componerWhatsapp, sinArroba } from "@/lib/eventos";
import { crearPerfil } from "@/lib/registroPublicador";
import { tokenParaWhatsapp } from "@/lib/tokenOrganizador";
import {
  COOKIE_PUBLICADOR,
  COOKIE_REGISTRO,
  crearTokenPublicador,
  leerRegistro,
} from "@/lib/sesionPublicador";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request: Request) {
  if (!SUPABASE_URL || !ANON_KEY) {
    return NextResponse.json({ error: "Config incompleta." }, { status: 500 });
  }

  const reg = await leerRegistro();
  if (!reg) {
    return NextResponse.json(
      { error: "Empieza el registro de nuevo." },
      { status: 401 },
    );
  }

  const cabecera = request.headers.get("authorization") ?? "";
  const bearer = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  const comoUsuario = bearer
    ? createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  const { data: userData } = comoUsuario
    ? await comoUsuario.auth.getUser()
    : { data: { user: null } };
  const user = userData?.user ?? null;

  if (!user || user.id !== reg.userId) {
    const tarro = await cookies();
    tarro.delete(COOKIE_REGISTRO);
    return NextResponse.json(
      { error: "Tu sesión de Google cambió. Empieza el registro de nuevo." },
      { status: 401 },
    );
  }

  if (!reg.smsOk || !reg.correoOk) {
    return NextResponse.json(
      { error: "Todavía faltan verificar el celular y el correo." },
      { status: 403 },
    );
  }

  let cuerpo: {
    imagenUrl?: string;
    instagram?: string;
    tiktok?: string;
    indicativoPublico?: string;
    whatsappPublico?: string;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }

  const indPub =
    String(cuerpo.indicativoPublico ?? "57").replace(/\D/g, "") || "57";
  const whatsappPublico = cuerpo.whatsappPublico
    ? componerWhatsapp(indPub, cuerpo.whatsappPublico)
    : reg.celular;

  const igRaw = String(cuerpo.instagram ?? "").trim();
  const ttRaw = String(cuerpo.tiktok ?? "").trim();

  const res = await crearPerfil({
    tipo: reg.tipo,
    nombre: reg.nombre,
    celular: reg.celular,
    whatsappPublico,
    instagram: igRaw ? sinArroba(igRaw) : null,
    tiktok: ttRaw ? sinArroba(ttRaw) : null,
    imagenUrl: String(cuerpo.imagenUrl ?? "").trim() || null,
    correo: reg.correo,
    adminNombre: reg.adminNombre,
    adminApellido: reg.adminApellido,
    adminEdad: reg.adminEdad,
    userId: reg.userId,
  });

  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }

  // Link de /mis-eventos (se reutiliza si el número ya publicó antes). Best
  // effort: si falla, el alta sigue en pie.
  try {
    await tokenParaWhatsapp(reg.celular);
  } catch {
    // sin link; no es bloqueante
  }

  const { token, maxAge } = crearTokenPublicador(
    res.perfilId,
    res.nombre,
    reg.celular,
  );
  const tarro = await cookies();
  tarro.set(COOKIE_PUBLICADOR, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  tarro.delete(COOKIE_REGISTRO);

  return NextResponse.json({ ok: true, destino: "/" });
}
