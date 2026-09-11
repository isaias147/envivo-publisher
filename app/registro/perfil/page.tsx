"use client";

// Pantalla 7 · /registro/perfil — así te van a ver.
// Foto (opcional), Instagram, TikTok (opcional) y WhatsApp público
// (prellenado con el de cuenta). Al enviar: POST /api/registro/perfil crea el
// perfil, deja la sesión y redirige al mapa (/).
//
// La foto se sube al bucket `flyers` (prefijo `perfiles/`) con la anon key,
// igual que el flyer de un evento.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  PAISES_WHATSAPP,
  PAIS_WHATSAPP_POR_DEFECTO,
} from "@/lib/eventos";
import styles from "../registro.module.css";

const TIPOS_OK = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 3 * 1024 * 1024;

/** "573002917326" → { indicativo: "57", nacional: "3002917326" }. */
function partirWhatsapp(wa: string): { indicativo: string; nacional: string } {
  const d = (wa ?? "").replace(/\D/g, "");
  const inds = [...new Set(PAISES_WHATSAPP.map((p) => p.indicativo))].sort(
    (a, b) => b.length - a.length,
  );
  for (const ind of inds) {
    if (d.startsWith(ind) && d.length - ind.length >= 6) {
      return { indicativo: ind, nacional: d.slice(ind.length) };
    }
  }
  return { indicativo: PAIS_WHATSAPP_POR_DEFECTO, nacional: d };
}

export default function PerfilNuevo() {
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [indicativo, setIndicativo] = useState(PAIS_WHATSAPP_POR_DEFECTO);
  const [whatsapp, setWhatsapp] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/registro/estado", { cache: "no-store" });
        const j = await r.json();
        if (!vivo) return;
        if (j.sinRegistro) {
          router.replace("/registro");
          return;
        }
        if (!j.smsOk || !j.correoOk) {
          router.replace("/registro/verificar");
          return;
        }
        const { indicativo: ind, nacional } = partirWhatsapp(j.celular ?? "");
        setIndicativo(ind);
        setWhatsapp(nacional);
      } catch {
        // sin conexión: dejamos el formulario visible
      }
      if (vivo) setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [router]);

  async function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (!TIPOS_OK.includes(file.type)) {
      setError("La foto debe ser JPG, PNG o WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("La foto pesa más de 3 MB.");
      return;
    }
    setSubiendoFoto(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const ruta = `perfiles/${crypto.randomUUID()}.${ext}`;
      const { error: errSubida } = await supabase.storage
        .from("flyers")
        .upload(ruta, file, { contentType: file.type, upsert: false });
      if (errSubida) {
        setError("No se pudo subir la foto. Intenta de nuevo.");
      } else {
        const { data } = supabase.storage.from("flyers").getPublicUrl(ruta);
        setImagenUrl(data.publicUrl);
      }
    } catch {
      setError("No se pudo subir la foto. Intenta de nuevo.");
    }
    setSubiendoFoto(false);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError(null);
    setEnviando(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const r = await fetch("/api/registro/perfil", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          imagenUrl,
          instagram,
          tiktok,
          indicativoPublico: indicativo,
          whatsappPublico: whatsapp,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudo guardar el perfil.");
        setEnviando(false);
        return;
      }
      router.replace(j.destino ?? "/");
    } catch {
      setError("Falló la conexión. Intenta de nuevo.");
      setEnviando(false);
    }
  }

  if (cargando) {
    return (
      <div className={styles.pantalla}>
        <p className={styles.cargandoPantalla}>Cargando…</p>
      </div>
    );
  }

  return (
    <div className={styles.pantalla}>
      <form className={styles.marco} onSubmit={enviar}>
        <div className={styles.marca}>
          En<i>Vivo</i>
        </div>
        <div className={styles.ruta}>envivo.app/registro/perfil</div>

        <h1 className={styles.tit}>Así te van a ver</h1>
        <p className={styles.bajada}>
          Estos datos aparecen en tus eventos y tu perfil público.
        </p>

        <button
          type="button"
          className={styles.avatarEditar}
          onClick={() => fileRef.current?.click()}
          aria-label="Subir foto de perfil"
        >
          {imagenUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagenUrl} alt="" />
          ) : subiendoFoto ? (
            "…"
          ) : (
            "＋"
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={elegirFoto}
          />
        </button>

        <div className={styles.campo}>
          <label htmlFor="ig">Instagram</label>
          <input
            id="ig"
            placeholder="@tucuenta"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
          />
        </div>

        <div className={styles.campo}>
          <label htmlFor="tt">TikTok (opcional)</label>
          <input
            id="tt"
            placeholder="@tucuenta"
            value={tiktok}
            onChange={(e) => setTiktok(e.target.value)}
          />
        </div>

        <div className={styles.campo}>
          <label htmlFor="wapub">WhatsApp público (contacto)</label>
          <div className={styles.telFila}>
            <select
              aria-label="Indicativo de país"
              value={indicativo}
              onChange={(e) => setIndicativo(e.target.value)}
            >
              {PAISES_WHATSAPP.map((p) => (
                <option key={p.nombre} value={p.indicativo}>
                  +{p.indicativo} · {p.nombre}
                </option>
              ))}
            </select>
            <input
              id="wapub"
              type="tel"
              inputMode="numeric"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          </div>
        </div>

        <button
          type="submit"
          className={styles.principal}
          disabled={enviando || subiendoFoto}
        >
          {enviando ? "Guardando…" : "Listo, entrar a EnVivo"}
        </button>

        {error && <p className={styles.error}>{error}</p>}
      </form>
    </div>
  );
}
