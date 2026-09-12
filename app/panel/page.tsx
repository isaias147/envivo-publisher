// Pantalla 9 · /panel — inicio del publicador.
//
// Server Component: lee la cookie `envivo_publicador` y, si no hay (nunca se
// registró, o cerró sesión), manda a /yo en vez de /registro — /panel es del
// publicador, /yo decide desde ahí si quiere registrarse.
//
// Sesión 15: además del acceso a Publicar/Mis eventos, muestra el panel de
// métricas del dueño — seguidores del perfil y, por cada evento suyo,
// cuántas vistas (`vistas_evento`) y denuncias (`reportes`) acumuló. Son
// conteos crudos y privados, solo visibles para el dueño (como el nº real de
// seguidores en /perfil). La línea roja del spec quedó acotada para permitir
// justo esto: sigue prohibido cualquier ranking, comparación o métrica
// visible entre publicadores (ver CLAUDE.md, "Línea roja").

import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServidor } from "@/lib/supabaseServidor";
import { leerSesionPublicador } from "@/lib/sesionPublicador";
import styles from "./page.module.css";

type FilaMetrica = { id: string; titulo: string; vistas: number; denuncias: number };

export default async function Panel() {
  const sesion = await leerSesionPublicador();
  if (!sesion) redirect("/yo");

  // Link a /mis-eventos si ese celular de cuenta ya tiene token (access_tokens
  // sigue keyeado por el WhatsApp/celular con el que se publicaron eventos).
  const { data: tk } = await supabaseServidor
    .from("access_tokens")
    .select("token")
    .eq("whatsapp", sesion.celular)
    .maybeSingle();
  const misEventos = tk?.token ? `/mis-eventos/${tk.token}` : "/mis-eventos";

  const { count: nSeguidores } = await supabaseServidor
    .from("seguimientos")
    .select("*", { count: "exact", head: true })
    .eq("perfil_id", sesion.perfilId);

  const { data: eventosPerfil } = await supabaseServidor
    .from("events")
    .select("id, title")
    .eq("perfil_id", sesion.perfilId);

  const ids = (eventosPerfil ?? []).map((e) => e.id as string);

  const vistasPorEvento = new Map<string, number>();
  const denunciasPorEvento = new Map<string, number>();
  if (ids.length > 0) {
    const [{ data: vistasRows }, { data: reportesRows }] = await Promise.all([
      supabaseServidor.from("vistas_evento").select("event_id").in("event_id", ids),
      supabaseServidor.from("reportes").select("event_id").in("event_id", ids),
    ]);
    for (const r of vistasRows ?? []) {
      vistasPorEvento.set(r.event_id, (vistasPorEvento.get(r.event_id) ?? 0) + 1);
    }
    for (const r of reportesRows ?? []) {
      denunciasPorEvento.set(r.event_id, (denunciasPorEvento.get(r.event_id) ?? 0) + 1);
    }
  }

  const filas: FilaMetrica[] = (eventosPerfil ?? [])
    .map((e) => ({
      id: e.id as string,
      titulo: e.title as string,
      vistas: vistasPorEvento.get(e.id as string) ?? 0,
      denuncias: denunciasPorEvento.get(e.id as string) ?? 0,
    }))
    .sort((a, b) => b.vistas - a.vistas);

  return (
    <div className={styles.pantalla}>
      <div className={styles.marco}>
        <div className={styles.marca}>
          En<i>Vivo</i>
        </div>
        <div className={styles.ruta}>envivo.app/panel</div>

        <h1 className={styles.tit}>Hola, {sesion.nombre ?? "publicador"}</h1>
        <p className={styles.bajada}>
          Tu cuenta ya está lista. Desde acá vas a manejar tus eventos y tu
          perfil.
        </p>

        <div className={styles.seguidores}>
          <span className={styles.seguidoresNum}>{nSeguidores ?? 0}</span>
          <span>{nSeguidores === 1 ? "seguidor" : "seguidores"}</span>
        </div>

        {filas.length > 0 && (
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Vistas</th>
                <th>Denuncias</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.titulo}</td>
                  <td>{f.vistas}</td>
                  <td>{f.denuncias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <nav className={styles.accesos}>
          <Link className={styles.acceso} href="/publicar">
            <span>Publicar evento</span>
            <span className={styles.flecha}>→</span>
          </Link>
          <Link className={styles.acceso} href={misEventos}>
            <span>Mis eventos</span>
            <span className={styles.flecha}>→</span>
          </Link>
          <span className={`${styles.acceso} ${styles.pronto}`}>
            <span>Editar perfil</span>
            <span className={styles.flecha}>pronto</span>
          </span>
          <span className={`${styles.acceso} ${styles.pronto}`}>
            <span>Ver mi perfil público</span>
            <span className={styles.flecha}>pronto</span>
          </span>
        </nav>

        <form action="/api/registro/logout" method="post">
          <button type="submit" className={styles.salir}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
