"use client";

// Pantalla /registro — alta del publicador, UNA sola pantalla (antes 5a+5b).
// Sigue el slot "5b · Registro — datos" de envivo-registro-actualizado.html.
//
// Exige sesión de Google ANTES del formulario: primero cuenta de Google,
// luego el registro de publicador por SMS + correo (Twilio Verify). Sin
// sesión de Google se muestra una puerta con el modal en vez del formulario;
// el modal vuelve a /registro al terminar (entrarConGoogle usa la URL
// actual). El userId real se valida en el servidor (auth.getUser) recién en
// POST /api/registro/iniciar, nunca se confía en el del cliente.
//
// Tipo de perfil = <select> (ya no tarjetas). Además del nombre y el
// celular, pide los datos del administrador (nombre, apellido, edad) y el
// correo. Al enviar → POST /api/registro/iniciar manda los DOS códigos
// (SMS + correo) y seguimos a /registro/verificar.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useUsuario } from "@/lib/authUsuario";
import ModalEntrarConGoogle from "@/components/ModalEntrarConGoogle";
import { PAISES_WHATSAPP, PAIS_WHATSAPP_POR_DEFECTO } from "@/lib/eventos";
import { TIPOS_PERFIL, type TipoPerfil } from "@/lib/tiposPerfil";
import styles from "./registro.module.css";

export default function Registro() {
  const router = useRouter();
  const { usuario, cargando: cargandoUsuario } = useUsuario();
  // El modal se abre solo (derivado, sin efecto) mientras falte Google y no
  // lo hayan cerrado a mano con "Ahora no"; el botón de la puerta lo reabre.
  const [modalCerrado, setModalCerrado] = useState(false);
  const [revisando, setRevisando] = useState(true);

  const [tipo, setTipo] = useState<TipoPerfil>(TIPOS_PERFIL[0].valor);
  const [nombre, setNombre] = useState("");
  const [adminNombre, setAdminNombre] = useState("");
  const [adminApellido, setAdminApellido] = useState("");
  const [adminEdad, setAdminEdad] = useState("");
  const [indicativo, setIndicativo] = useState(PAIS_WHATSAPP_POR_DEFECTO);
  const [celular, setCelular] = useState("");
  const [correo, setCorreo] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si ya hay sesión de publicador, directo al panel (no hace falta Google
  // para esto: ya está registrado).
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/registro/sesion", { cache: "no-store" });
        const j = await r.json();
        if (vivo && j.activa) {
          router.replace("/panel");
          return;
        }
      } catch {
        // sin conexión: mostramos el formulario igual
      }
      if (vivo) setRevisando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [router]);

  const infoTipo = TIPOS_PERFIL.find((t) => t.valor === tipo);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError(null);

    const edad = Number(adminEdad);
    if (nombre.trim().length < 2) {
      setError("Escribe el nombre del local o marca.");
      return;
    }
    if (adminNombre.trim().length < 2 || adminApellido.trim().length < 2) {
      setError("Faltan el nombre y el apellido del administrador.");
      return;
    }
    if (!Number.isInteger(edad) || edad < 14 || edad > 120) {
      setError("Escribe una edad válida.");
      return;
    }
    if (!celular.trim()) {
      setError("Falta el celular.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())) {
      setError("Escribe un correo válido.");
      return;
    }

    setEnviando(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const r = await fetch("/api/registro/iniciar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          tipo,
          nombre,
          indicativo,
          celular,
          correo,
          adminNombre,
          adminApellido,
          adminEdad: edad,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "No se pudieron enviar los códigos.");
        setEnviando(false);
        return;
      }
      router.push("/registro/verificar");
    } catch {
      setError("Falló la conexión. Intenta de nuevo.");
      setEnviando(false);
    }
  }

  if (revisando || cargandoUsuario) {
    return (
      <div className={styles.pantalla}>
        <p className={styles.cargandoPantalla}>Cargando…</p>
      </div>
    );
  }

  // Publicar exige cuenta de Google, primero. Sin ella, no se ve el
  // formulario: solo la puerta + el modal (que vuelve acá al terminar).
  if (!usuario) {
    return (
      <div className={styles.pantalla}>
        <div className={styles.marco}>
          <div className={styles.marca}>
            En<i>Vivo</i>
          </div>
          <div className={styles.ruta}>envivo.app/registro</div>

          <h1 className={styles.tit}>Crea tu cuenta</h1>
          <p className={styles.bajada}>
            Primero entra con tu cuenta de Google. Después te pedimos el
            celular y el correo para verificarte.
          </p>
          <button
            type="button"
            className={styles.principal}
            onClick={() => setModalCerrado(false)}
          >
            Entrar con Google
          </button>
        </div>

        <ModalEntrarConGoogle
          abierto={!modalCerrado}
          onCerrar={() => setModalCerrado(true)}
          titulo="Entra para registrar tu perfil"
          descripcion="Necesitamos tu cuenta de Google para saber quién administra el perfil. Después verificamos el celular y el correo del negocio."
        />
      </div>
    );
  }

  return (
    <div className={styles.pantalla}>
      <div className={styles.marco}>
        <div className={styles.marca}>
          En<i>Vivo</i>
        </div>
        <div className={styles.ruta}>envivo.app/registro</div>

        <h1 className={styles.tit}>Crea tu cuenta</h1>
        <p className={styles.bajada}>
          Estos datos son para saber con quién nos comunicamos. No se muestran
          en público.
        </p>

        <form onSubmit={enviar}>
          <div className={styles.campo}>
            <label htmlFor="tipo">¿Cómo publicas?</label>
            <select
              id="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoPerfil)}
            >
              {TIPOS_PERFIL.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.icono} {t.titulo} — {t.detalle}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.campo}>
            <label htmlFor="nombre">
              {infoTipo?.etiquetaNombre ?? "Nombre del local / marca"}
            </label>
            <input
              id="nombre"
              value={nombre}
              maxLength={80}
              autoComplete="organization"
              onChange={(e) => {
                setNombre(e.target.value);
                setError(null);
              }}
            />
          </div>

          <div className={styles.seccion}>
            <div className={styles.seccionTit}>Datos del administrador</div>
            <div className={styles.seccionSub}>
              La persona responsable de esta cuenta.
            </div>

            <div className={styles.fila2}>
              <div className={styles.campo}>
                <label htmlFor="admin-nombre">Nombre</label>
                <input
                  id="admin-nombre"
                  value={adminNombre}
                  maxLength={60}
                  autoComplete="given-name"
                  onChange={(e) => {
                    setAdminNombre(e.target.value);
                    setError(null);
                  }}
                />
              </div>
              <div className={styles.campo}>
                <label htmlFor="admin-apellido">Apellido</label>
                <input
                  id="admin-apellido"
                  value={adminApellido}
                  maxLength={60}
                  autoComplete="family-name"
                  onChange={(e) => {
                    setAdminApellido(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            </div>

            <div className={styles.campo}>
              <label htmlFor="admin-edad">Edad</label>
              <input
                id="admin-edad"
                type="number"
                inputMode="numeric"
                min={14}
                max={120}
                value={adminEdad}
                style={{ maxWidth: 110 }}
                onChange={(e) => {
                  setAdminEdad(e.target.value);
                  setError(null);
                }}
              />
            </div>
          </div>

          <div className={styles.seccion}>
            <div className={styles.seccionTit}>Contacto para verificar</div>
            <div className={styles.seccionSub}>
              Vas a recibir un código en cada uno.
            </div>

            <div className={styles.campo}>
              <label htmlFor="celular">Celular (recibe el código por SMS)</label>
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
                  id="celular"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="300 291 7326"
                  value={celular}
                  onChange={(e) => {
                    setCelular(e.target.value);
                    setError(null);
                  }}
                />
              </div>
              <p className={styles.notaCampo}>
                Este número es solo para verificarte. No tiene que ser el mismo
                que publiques después.
              </p>
            </div>

            <div className={styles.campo}>
              <label htmlFor="correo">Correo</label>
              <input
                id="correo"
                type="email"
                autoComplete="email"
                placeholder="tu@correo.com"
                value={correo}
                onChange={(e) => {
                  setCorreo(e.target.value);
                  setError(null);
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            className={styles.principal}
            style={{ marginTop: 8 }}
            disabled={enviando}
          >
            {enviando ? "Enviando…" : "Enviar códigos"}
          </button>

          {error && <p className={styles.error}>{error}</p>}
        </form>
      </div>
    </div>
  );
}
