// POST /api/registro/reenviar  { canal: "sms" | "email" }
//
// "¿No llegó? Reenviar" de /registro/verificar, por canal. Toma el destino
// de la cookie `envivo_registro` y le pide otro código a Twilio Verify.

import { NextResponse } from "next/server";
import { iniciarVerificacion, type Canal } from "@/lib/registroPublicador";
import { leerRegistro } from "@/lib/sesionPublicador";

export async function POST(request: Request) {
  const reg = await leerRegistro();
  if (!reg) {
    return NextResponse.json(
      { error: "Empieza el registro de nuevo." },
      { status: 401 },
    );
  }

  let cuerpo: { canal?: string };
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = {};
  }
  const canal: Canal = cuerpo.canal === "email" ? "email" : "sms";
  const destino = canal === "email" ? reg.correo : reg.celular;

  const res = await iniciarVerificacion(destino, canal);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }
  return NextResponse.json({ ok: true });
}
