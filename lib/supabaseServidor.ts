// ⚠️ SOLO SERVIDOR. Este módulo usa la service_role key de Supabase, que
// salta todas las reglas de RLS. Nunca lo importes desde un componente de
// cliente ("use client") ni desde lib/eventos.ts. Solo desde API routes
// (app/api/**/route.ts). Si Next.js intentara mandarlo al navegador, el
// build fallaría por no encontrar la variable de entorno abajo.

import "server-only";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local",
  );
}

/**
 * Cliente con permisos de administrador. Se salta RLS: úsalo solo para
 * lo que el panel necesita (leer pendientes, aprobar, rechazar, fusionar)
 * y después de comprobar la sesión con `leerSesionAdmin()`.
 */
export const supabaseServidor = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
