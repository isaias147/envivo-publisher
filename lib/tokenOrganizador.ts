// ⚠️ SOLO SERVIDOR. Usa `supabaseServidor` (service_role), que se salta RLS.
// Importar solo desde API routes o Server Components, nunca desde "use client".
//
// Un organizador no tiene cuenta: su "acceso" a /mis-eventos es un token
// ligado a su WhatsApp en la tabla `access_tokens`. El token se crea la
// primera vez que le aprobamos (o fusionamos) un evento y se reutiliza
// siempre que vuelva a publicar con el mismo número.

import "server-only";

import { supabaseServidor } from "@/lib/supabaseServidor";
import { normalizarWhatsapp } from "@/lib/eventos";

/**
 * Devuelve el token de /mis-eventos para ese WhatsApp, creándolo si aún no
 * existe. El número se limpia a solo dígitos igual que `events.whatsapp`
 * (que ya se guardó como indicativo + dígitos), para que el token empareje
 * siempre con los mismos eventos que ve el panel.
 *
 * Devuelve null si el WhatsApp viene vacío o si la base falla: quien llama
 * debe tratar eso como "no se pudo generar el link", nunca como un error que
 * revierta la aprobación.
 */
export async function tokenParaWhatsapp(
  whatsapp: string | null | undefined,
): Promise<string | null> {
  const wa = normalizarWhatsapp(whatsapp);
  if (!wa) return null;

  // ¿Ya tiene token?
  const { data: existente } = await supabaseServidor
    .from("access_tokens")
    .select("token")
    .eq("whatsapp", wa)
    .maybeSingle();
  if (existente?.token) return existente.token;

  // No: crearlo. La columna `token` trae su propio valor por defecto.
  const { data: creado, error } = await supabaseServidor
    .from("access_tokens")
    .insert({ whatsapp: wa })
    .select("token")
    .single();

  if (!error && creado?.token) return creado.token;

  // Carrera: otra aprobación del mismo número lo creó entre el select y el
  // insert (whatsapp es único → 23505). Volvemos a leerlo.
  const { data: reintento } = await supabaseServidor
    .from("access_tokens")
    .select("token")
    .eq("whatsapp", wa)
    .maybeSingle();
  return reintento?.token ?? null;
}
