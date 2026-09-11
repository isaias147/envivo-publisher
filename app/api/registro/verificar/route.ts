// POST /api/registro/verificar  { canal: "sms" | "email", codigo }
//
// Lo llama /registro/verificar por cada canal. Toma el destino de la cookie
// `envivo_registro` (celular o correo según el canal), se lo pasa a Twilio
// Verify y, si lo aprueba, vuelve a firmar la cookie con el flag del canal
// (`smsOk` / `correoOk`) en true, conservando el otro y el resto de datos.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { comprobarCodigo, type Canal } from "@/lib/registroPublicador";
import {
  COOKIE_REGISTRO,
  crearTokenRegistro,
  leerRegistro,
} from "@/lib/sesionPublicador";

export async function POST(request: Request) {
  const reg = await leerRegistro();
  if (!reg) {
    return NextResponse.json(
      { error: "Empieza el registro de nuevo." },
      { status: 401 },
    );
  }

  let cuerpo: { canal?: string; codigo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }

  const canal: Canal = cuerpo.canal === "email" ? "email" : "sms";
  const destino = canal === "email" ? reg.correo : reg.celular;

  const res = await comprobarCodigo(destino, String(cuerpo.codigo ?? ""), canal);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }

  const smsOk = canal === "sms" ? true : !!reg.smsOk;
  const correoOk = canal === "email" ? true : !!reg.correoOk;

  const { token, maxAge } = crearTokenRegistro({
    tipo: reg.tipo,
    nombre: reg.nombre,
    celular: reg.celular,
    correo: reg.correo,
    adminNombre: reg.adminNombre,
    adminApellido: reg.adminApellido,
    adminEdad: reg.adminEdad,
    userId: reg.userId,
    smsOk,
    correoOk,
  });
  const tarro = await cookies();
  tarro.set(COOKIE_REGISTRO, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });

  return NextResponse.json({ ok: true, smsOk, correoOk });
}
