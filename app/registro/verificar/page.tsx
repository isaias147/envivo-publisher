"use client";

// Pantalla /registro/verificar — DOS canales obligatorios (SMS + correo).
// Sigue el slot "6 · Verificar — SMS y correo" de
// envivo-registro-actualizado.html.
//
// Twilio Verify ya mandó los dos códigos desde /registro. Acá el usuario
// escribe cada uno en su caja; POST /api/registro/verificar { canal, codigo }
// valida. "Continuar" se habilita cuando los dos están verificados.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatearWhatsapp } from "@/lib/eventos";
import styles from "../registro.module.css";

// SMS lo genera Twilio Verify (Code Length = 6); el correo lo generamos
// nosotros en lib/codigoCorreo.ts con 4 dígitos.
const LARGO_SMS = 6;
const LARGO_CORREO = 4;
const largoDe = (canal: string) => (canal === "email" ? LARGO_CORREO : LARGO_SMS);
type Canal = "sms" | "email";

export default function Verificar() {
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [celular, setCelular] = useState("");
  const [correo, setCorreo] = useState("");
  const [smsOk, setSmsOk] = useState(false);
  const [correoOk, setCorreoOk] = useState(false);
  const yaSalte = useRef(false);

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
        setCelular(j.celular ?? "");
        setCorreo(j.correo ?? "");
        setSmsOk(!!j.smsOk);
        setCorreoOk(!!j.correoOk);
        if (j.smsOk && j.correoOk && !yaSalte.current) {
          yaSalte.current = true;
          router.replace("/registro/perfil");
          return;
        }
      } catch {
        // sin conexión: mostramos las cajas igual
      }
      if (vivo) setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [router]);

  const marcar = useCallback(
    (canal: Canal, ok: boolean) => {
      if (canal === "sms") setSmsOk(ok);
      else setCorreoOk(ok);
    },
    [],
  );

  // Cuando quedan los dos, seguir.
  useEffect(() => {
    if (smsOk && correoOk && !yaSalte.current) {
      yaSalte.current = true;
      router.replace("/registro/perfil");
    }
  }, [smsOk, correoOk, router]);

  if (cargando) {
    return (
      <div className={styles.pantalla}>
        <p className={styles.cargandoPantalla}>Cargando…</p>
      </div>
    );
  }

  return (
    <div className={styles.pantalla}>
      <div className={styles.marco}>
        <div className={styles.marca}>
          En<i>Vivo</i>
        </div>
        <div className={styles.ruta}>envivo.app/registro/verificar</div>

        <h1 className={styles.tit}>Confirma los dos</h1>
        <p className={styles.bajada}>
          Necesitamos verificar tu número y tu correo antes de continuar.
        </p>

        <Canal
          canal="sms"
          titulo="📱 SMS"
          destino={celular ? formatearWhatsapp(celular) : ""}
          verificado={smsOk}
          onVerificado={() => marcar("sms", true)}
        />
        <Canal
          canal="email"
          titulo="✉️ Correo"
          destino={correo}
          verificado={correoOk}
          onVerificado={() => marcar("email", true)}
        />

        <button
          type="button"
          className={styles.principal}
          disabled={!smsOk || !correoOk}
          onClick={() => router.replace("/registro/perfil")}
        >
          Continuar
        </button>
        {(!smsOk || !correoOk) && (
          <p className={styles.notaCentrada}>
            El botón se activa cuando los dos canales estén verificados.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- una tarjeta de canal ----------

function Canal({
  canal,
  titulo,
  destino,
  verificado,
  onVerificado,
}: {
  canal: Canal;
  titulo: string;
  destino: string;
  verificado: boolean;
  onVerificado: () => void;
}) {
  const LARGO = largoDe(canal);
  const [valores, setValores] = useState<string[]>(Array(LARGO).fill(""));
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const casillas = useRef<(HTMLInputElement | null)[]>([]);

  const enviar = useCallback(
    async (codigo: string) => {
      if (enviando || verificado) return;
      setEnviando(true);
      setError(null);
      try {
        const r = await fetch("/api/registro/verificar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canal, codigo }),
        });
        const j = await r.json();
        if (!r.ok) {
          setError(j.error ?? "No se pudo verificar el código.");
          setValores(Array(LARGO).fill(""));
          casillas.current[0]?.focus();
          setEnviando(false);
          return;
        }
        onVerificado();
      } catch {
        setError("Falló la conexión. Intenta de nuevo.");
        setEnviando(false);
      }
    },
    [canal, enviando, verificado, onVerificado],
  );

  function escribir(i: number, bruto: string) {
    const digitos = bruto.replace(/\D/g, "");
    if (!digitos) return;
    setError(null);
    setValores((prev) => {
      const sig = [...prev];
      for (let k = 0; k < digitos.length && i + k < LARGO; k++) {
        sig[i + k] = digitos[k];
      }
      const foco = Math.min(i + digitos.length, LARGO - 1);
      casillas.current[foco]?.focus();
      if (sig.every((d) => d !== "")) void enviar(sig.join(""));
      return sig;
    });
  }

  function teclear(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !valores[i] && i > 0) {
      casillas.current[i - 1]?.focus();
      setValores((prev) => {
        const sig = [...prev];
        sig[i - 1] = "";
        return sig;
      });
    }
  }

  async function reenviar() {
    if (reenviando) return;
    setError(null);
    setAviso(null);
    setReenviando(true);
    try {
      const r = await fetch("/api/registro/reenviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal }),
      });
      const j = await r.json();
      if (!r.ok) setError(j.error ?? "No se pudo reenviar.");
      else {
        setAviso("Te mandamos otro código.");
        setValores(Array(LARGO).fill(""));
        casillas.current[0]?.focus();
      }
    } catch {
      setError("Falló la conexión. Intenta de nuevo.");
    }
    setReenviando(false);
  }

  return (
    <div
      className={`${styles.canal} ${verificado ? styles.canalHecho : ""}`}
    >
      <div className={styles.canalCab}>
        <b>{titulo}</b>
        <span className={styles.canalEstado}>
          {verificado ? "✓ Verificado" : "Pendiente"}
        </span>
      </div>
      {destino && <div className={styles.canalDestino}>{destino}</div>}

      {verificado ? (
        <div className={styles.canalHechoTexto}>✓ Código confirmado</div>
      ) : (
        <>
          <div className={styles.codigoInputs}>
            {valores.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  casillas.current[i] = el;
                }}
                className={`${styles.digitoInput} ${d ? styles.lleno : ""}`}
                type="text"
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                maxLength={LARGO}
                value={d}
                disabled={enviando}
                onChange={(e) => escribir(i, e.target.value)}
                onKeyDown={(e) => teclear(i, e)}
                aria-label={`${titulo} · dígito ${i + 1}`}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.reintento}
            onClick={reenviar}
            disabled={reenviando}
          >
            {reenviando ? "Reenviando…" : "¿No llegó? Reenviar"}
          </button>
          {aviso && <p className={styles.verificado}>{aviso}</p>}
          {error && <p className={styles.error}>{error}</p>}
        </>
      )}
    </div>
  );
}
