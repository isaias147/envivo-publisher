"use client";

// Hoja inferior "Entrar con Google" (Sesión 14, paso 1).
// Sigue el slot 2 de envivo-grupo1-publico.html: fondo oscuro + hoja pegada
// abajo con asa, título, explicación y dos botones.
//
// - Se abre SOBRE el contexto actual (portal a <body>), no navega.
// - "Continuar con Google" arranca el OAuth de Supabase (auth.users). Al
//   volver, el usuario queda en la misma URL (ver lib/authUsuario.ts).
// - Paso 1: no está conectado a ningún botón real todavía.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { entrarConGoogle } from "@/lib/authUsuario";
import styles from "./ModalEntrarConGoogle.module.css";

const TITULO_DEFECTO = "Entra a EnVivo";
const DESCRIPCION_DEFECTO =
  "Con tu cuenta puedes seguir a locales, organizadores y artistas y recibir un aviso cuando publiquen algo nuevo. No hace falta para ver el mapa.";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  titulo?: string;
  descripcion?: string;
};

export default function ModalEntrarConGoogle({
  abierto,
  onCerrar,
  titulo = TITULO_DEFECTO,
  descripcion = DESCRIPCION_DEFECTO,
}: Props) {
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alTecla);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alTecla);
      document.body.style.overflow = overflowPrevio;
    };
  }, [abierto, onCerrar]);

  // `abierto` solo pasa a true por interacción del usuario (nunca en SSR),
  // así que no hay desajuste de hidratación al portalar a <body>.
  if (!abierto || typeof document === "undefined") return null;

  async function continuar() {
    if (yendo) return;
    setYendo(true);
    setError(null);
    const err = await entrarConGoogle();
    if (err) {
      setError("No se pudo iniciar sesión. Prueba de nuevo.");
      setYendo(false);
    }
    // Sin error: el navegador ya está saliendo hacia Google.
  }

  return createPortal(
    <div
      className={styles.velo}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-google-titulo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className={styles.hoja}>
        <div className={styles.asa} aria-hidden="true" />
        <h2 id="modal-google-titulo" className={styles.titulo}>
          {titulo}
        </h2>
        <p className={styles.descripcion}>{descripcion}</p>

        <button
          type="button"
          className={styles.google}
          onClick={continuar}
          disabled={yendo}
        >
          <IconoGoogle />
          {yendo ? "Abriendo Google…" : "Continuar con Google"}
        </button>

        <button type="button" className={styles.ahoraNo} onClick={onCerrar}>
          Ahora no
        </button>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>,
    document.body,
  );
}

const IconoGoogle = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
    />
  </svg>
);
