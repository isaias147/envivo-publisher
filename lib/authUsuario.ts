// Sesión de USUARIO FINAL (auth.users de Supabase Auth).
//
// ⚠️ Esto NO tiene nada que ver con la cookie `envivo_publicador` de
// `lib/sesionPublicador.ts`, que es la sesión del PUBLICADOR (HMAC propio,
// HttpOnly). Son dos sistemas de sesión distintos y no se mezclan:
//   - publicador  → cookie envivo_publicador, la maneja el servidor
//   - usuario final → Supabase Auth, token en localStorage del navegador
//
// El usuario final solo existe para "seguir" publicadores (Sesión 14). No
// publica nada ni ve el panel.

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const CLAVE_SCROLL = "envivo_scroll_login";
const VIGENCIA_SCROLL_MS = 2 * 60 * 1000;
const CLAVE_SEGUIR = "envivo_seguir_pendiente";

/**
 * "Quería seguir a este perfil pero tuvo que logearse antes." Se guarda al
 * abrir el modal desde el botón Seguir; al volver del login, el botón lo
 * lee y completa el follow solo. Se limpia al leerlo.
 */
export function marcarSeguirPendiente(perfilId: string): void {
  try {
    sessionStorage.setItem(CLAVE_SEGUIR, perfilId);
  } catch {
    // sin sessionStorage: el usuario tendrá que tocar Seguir otra vez
  }
}

export function tomarSeguirPendiente(): string | null {
  try {
    const v = sessionStorage.getItem(CLAVE_SEGUIR);
    if (v) sessionStorage.removeItem(CLAVE_SEGUIR);
    return v;
  } catch {
    return null;
  }
}

/**
 * Abre el flujo OAuth de Google. Antes guarda dónde está el usuario para
 * poder devolverlo al mismo sitio (misma URL + scroll) cuando vuelva del
 * login. `redirectTo` es la URL actual: nunca una ruta fija.
 * Devuelve un error si Supabase no pudo arrancar el flujo; si todo va bien,
 * el navegador ya está saliendo hacia Google cuando esta promesa resuelve.
 */
export async function entrarConGoogle(): Promise<Error | null> {
  const { origin, pathname, search } = window.location;
  const volverA = `${origin}${pathname}${search}`;

  try {
    sessionStorage.setItem(
      CLAVE_SCROLL,
      JSON.stringify({ ruta: `${pathname}${search}`, y: window.scrollY, t: Date.now() }),
    );
  } catch {
    // sin sessionStorage: se pierde solo el scroll, no es grave
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: volverA },
  });
  return error ?? null;
}

/**
 * Al volver del login, devuelve el scroll a donde estaba. Se llama una vez
 * al montar la app (RestaurarScrollLogin en el layout). No hace nada si no
 * venimos de un login o si la ruta ya no coincide.
 */
export function restaurarScrollTrasLogin(): void {
  let crudo: string | null = null;
  try {
    crudo = sessionStorage.getItem(CLAVE_SCROLL);
    if (crudo) sessionStorage.removeItem(CLAVE_SCROLL);
  } catch {
    return;
  }
  if (!crudo) return;

  try {
    const { ruta, y, t } = JSON.parse(crudo) as {
      ruta: string;
      y: number;
      t: number;
    };
    if (Date.now() - t > VIGENCIA_SCROLL_MS) return;
    if (ruta !== window.location.pathname + window.location.search) return;
    // tras el primer paint, con el contenido ya en su sitio
    requestAnimationFrame(() => window.scrollTo(0, y));
  } catch {
    // JSON raro: nada que hacer
  }
}

/** Cierra la sesión del usuario final (no toca la del publicador). */
export async function salir(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Hook: el usuario final logueado (o null) + si todavía estamos
 * comprobando. Se actualiza solo cuando entra o sale. (Lleva prefijo `use`
 * por la regla de hooks de React, no por el idioma.)
 */
export function useUsuario(): { usuario: User | null; cargando: boolean } {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!vivo) return;
      setUsuario(data.user ?? null);
      setCargando(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      if (vivo) setUsuario(sesion?.user ?? null);
    });

    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { usuario, cargando };
}
