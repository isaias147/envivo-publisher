// Tipos de perfil del publicador (local / organizador / artista).
//
// Módulo **sin dependencias de servidor** a propósito: lo importan tanto
// Server Components y API routes como el Client Component `/registro`. Antes
// vivía en `lib/registroPublicador.ts`, que arrastra la service_role key
// (`supabaseServidor`) y hacía que el bundle del cliente intentara leerla.

export type TipoPerfil = "local" | "organizador" | "artista";

export const TIPOS_PERFIL: {
  valor: TipoPerfil;
  icono: string;
  titulo: string;
  detalle: string;
  etiquetaNombre: string;
}[] = [
  {
    valor: "local",
    icono: "🏠",
    titulo: "Local",
    detalle: "Bar, restaurante, escuela, parque",
    etiquetaNombre: "Nombre del local",
  },
  {
    valor: "organizador",
    icono: "📋",
    titulo: "Organizador",
    detalle: "Monta eventos en distintos lugares",
    etiquetaNombre: "Nombre o marca",
  },
  {
    valor: "artista",
    icono: "🎤",
    titulo: "Artista",
    detalle: "Toca o se presenta en eventos de otros",
    etiquetaNombre: "Nombre artístico",
  },
];

export function esTipoPerfil(v: unknown): v is TipoPerfil {
  return v === "local" || v === "organizador" || v === "artista";
}
