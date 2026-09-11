// POST /api/registro/iniciar
//   { tipo, indicativo, celular, nombre,
//     adminNombre, adminApellido, adminEdad, correo }
//   Authorization: Bearer <access_token de Google>
//
// Pantalla /registro (5a+5b fusionadas). Exige sesión de Google: la valida
// con auth.getUser() (nunca confía en un userId del body) y guarda ese id en
// la cookie provisional para que /api/registro/perfil lo use al crear el
// `perfiles` (nunca del body). Valida todo, le pide a Twilio Verify que
// mande los DOS códigos (SMS + correo) y deja la cookie provisional
// `envivo_registro` con todos los datos (sin los flags smsOk / correoOk
// todavía). El perfil se crea recién en /api/registro/perfil.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { componerWhatsapp } from "@/lib/eventos";
import {
  esCorreoValido,
  iniciarVerificacion,
} from "@/lib/registroPublicador";
import { esTipoPerfil } from "@/lib/tiposPerfil";
import { COOKIE_REGISTRO, crearTokenRegistro } from "@/lib/sesionPublicador";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request: Request) {
  if (!SUPABASE_URL || !ANON_KEY) {
    return NextResponse.json({ error: "Config incompleta." }, { status: 500 });
  }

  const cabecera = request.headers.get("authorization") ?? "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) {
    return NextResponse.json(
      { error: "Necesitas entrar con Google antes de registrarte." },
      { status: 401 },
    );
  }
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: errUser,
  } = await comoUsuario.auth.getUser();
  if (errUser || !user) {
    return NextResponse.json(
      { error: "Tu sesión de Google venció. Entra de nuevo." },
      { status: 401 },
    );
  }

  let cuerpo: {
    tipo?: string;
    indicativo?: string;
    celular?: string;
    nombre?: string;
    adminNombre?: string;
    adminApellido?: string;
    adminEdad?: unknown;
    correo?: string;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }

  const tipo = String(cuerpo.tipo ?? "");
  const nombre = String(cuerpo.nombre ?? "").trim();
  const adminNombre = String(cuerpo.adminNombre ?? "").trim();
  const adminApellido = String(cuerpo.adminApellido ?? "").trim();
  const adminEdad = Number(cuerpo.adminEdad);
  const correo = String(cuerpo.correo ?? "").trim().toLowerCase();
  const indicativo = String(cuerpo.indicativo ?? "57").replace(/\D/g, "") || "57";
  const celular = componerWhatsapp(indicativo, cuerpo.celular);

  if (!esTipoPerfil(tipo)) {
    return NextResponse.json({ error: "Elige un tipo." }, { status: 400 });
  }
  if (nombre.length < 2 || nombre.length > 80) {
    return NextResponse.json(
      { error: "Escribe el nombre del local o marca (2 a 80 letras)." },
      { status: 400 },
    );
  }
  if (adminNombre.length < 2 || adminNombre.length > 60) {
    return NextResponse.json(
      { error: "Escribe el nombre del administrador." },
      { status: 400 },
    );
  }
  if (adminApellido.length < 2 || adminApellido.length > 60) {
    return NextResponse.json(
      { error: "Escribe el apellido del administrador." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(adminEdad) || adminEdad < 14 || adminEdad > 120) {
    return NextResponse.json(
      { error: "Escribe una edad válida." },
      { status: 400 },
    );
  }
  if (celular.length < 8) {
    return NextResponse.json(
      { error: "Escribe un celular válido." },
      { status: 400 },
    );
  }
  if (!esCorreoValido(correo)) {
    return NextResponse.json(
      { error: "Escribe un correo válido." },
      { status: 400 },
    );
  }

  // Manda los dos códigos. Si ninguno sale, no avanzamos. Si sale al menos
  // uno, seguimos: /registro/verificar tiene "reenviar" por canal.
  const [sms, email] = await Promise.all([
    iniciarVerificacion(celular, "sms"),
    iniciarVerificacion(correo, "email"),
  ]);
  if (!sms.ok && !email.ok) {
    return NextResponse.json({ error: sms.error }, { status: sms.status });
  }

  const { token: tokenRegistro, maxAge } = crearTokenRegistro({
    tipo,
    nombre,
    celular,
    correo,
    adminNombre,
    adminApellido,
    adminEdad,
    userId: user.id,
  });
  const tarro = await cookies();
  tarro.set(COOKIE_REGISTRO, tokenRegistro, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });

  return NextResponse.json({
    ok: true,
    smsError: sms.ok ? null : sms.error,
    correoError: email.ok ? null : email.error,
  });
}
