import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createApi,
  syntheticWarning,
  urgencyLabels,
  type PanelEntry,
  type Urgency,
} from "@brvital/contracts";
import {
  beginLogin,
  clearToken,
  completeLogin,
  configuredOAuth,
  restoreToken,
  saveToken,
} from "./auth";

const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
const localApi = ["localhost", "127.0.0.1", "[::1]"].includes(
  new URL(baseUrl).hostname,
);

export default function App({
  initialToken,
  development = import.meta.env.VITE_SYNTHETIC_AUTH === "true",
}: {
  initialToken?: string;
  development?: boolean;
}) {
  const [token, setToken] = useState<string | null>(
    () => initialToken ?? restoreToken(),
  );
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const api = useMemo(() => createApi(baseUrl, () => tokenRef.current), []);
  const [entries, setEntries] = useState<PanelEntry[]>([]);
  const [selected, setSelected] = useState<PanelEntry | null>(null);
  const [urgency, setUrgency] = useState("");
  const [disposition, setDisposition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const config = useMemo(configuredOAuth, []);
  const acting = useRef(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível concluir. Tente novamente.",
      );
    } finally {
      setBusy(false);
      acting.current = false;
    }
  }, []);
  useEffect(() => {
    if (
      !window.location.search.includes("code=") &&
      !window.location.search.includes("error=")
    )
      return;
    void run(async () => {
      try {
        if (!config)
          throw new Error("Configure o Cognito para concluir o acesso.");
        const value = await completeLogin(config);
        if (value) setToken(value);
      } finally {
        window.history.replaceState({}, "", window.location.pathname);
      }
    });
    // O callback OAuth é consumido apenas uma vez.
  }, [config, run]);
  useEffect(() => {
    if (!token) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const queue = await api.panelQueue();
        if (!disposed) {
          setEntries(queue);
          setLoaded(true);
        }
      } catch (err) {
        if (!disposed)
          setError(
            err instanceof Error
              ? err.message
              : "Falha ao carregar fila. Atualize para tentar novamente.",
          );
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [api, token]);

  return (
    <main>
      <header>
        <p>BR Vital · equipe hospitalar</p>
        <h1>Fila de pré-triagens</h1>
        <p>A classificação da unidade sempre prevalece.</p>
      </header>
      <aside className="notice">{syntheticWarning}</aside>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!token ? (
        <section aria-label="Acesso da equipe">
          <h2>Acesso da equipe</h2>
          <p>Entre com a conta autorizada do hospital.</p>
          {config ? (
            <button
              className="action"
              disabled={busy}
              onClick={() => void run(() => beginLogin(config))}
            >
              Entrar com Cognito
            </button>
          ) : (
            <p>
              O Cognito não está configurado. Defina domínio, identificador
              público do cliente e URL de retorno.
            </p>
          )}
          {development && localApi && (
            <>
              <p>
                Acesso local exclusivo para dados sintéticos. Não utiliza uma
                conta hospitalar real.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const response = await fetch(
                      `${baseUrl.replace(/\/$/, "")}/v1/auth/development-staff`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}",
                      },
                    );
                    if (!response.ok)
                      throw new Error(
                        "A API não autorizou o acesso sintético. Confira o modo de demonstração do servidor.",
                      );
                    const result = (await response.json()) as {
                      accessToken?: string;
                    };
                    if (!result.accessToken)
                      throw new Error(
                        "A API não retornou credencial da equipe.",
                      );
                    saveToken(result.accessToken);
                    setToken(result.accessToken);
                  })
                }
              >
                Entrar na demonstração sintética
              </button>
            </>
          )}
          <p className="muted">
            A credencial fica apenas nesta aba. Feche-a ou saia ao terminar. Não
            use em computador compartilhado.
          </p>
        </section>
      ) : (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setEntries(await api.panelQueue());
                setLoaded(true);
              })
            }
          >
            Atualizar fila
          </button>
          {!loaded && <p role="status">Carregando a fila…</p>}
          {loaded && entries.length === 0 && (
            <p>Nenhuma pré-triagem na fila desta unidade.</p>
          )}
          {!selected ? (
            entries.map((entry) => (
              <article key={entry.ticket.id}>
                <h2>
                  Senha {entry.ticket.displayCode ?? "aguardando confirmação"}
                </h2>
                <p className="urgency" data-level={entry.report.urgencyLevel}>
                  {urgencyLabels[entry.report.urgencyLevel]}
                </p>
                <p>{entry.report.specialties.join(", ")}</p>
                <button
                  onClick={() => {
                    setSelected(entry);
                    setUrgency("");
                    setDisposition("");
                    setNotice("");
                  }}
                  aria-label={`Abrir laudo ${entry.ticket.displayCode ?? entry.ticket.id}`}
                >
                  Abrir laudo {entry.ticket.displayCode ?? "sem código"}
                </button>
              </article>
            ))
          ) : (
            <section aria-label="Laudo e classificação">
              <button disabled={busy} onClick={() => setSelected(null)}>
                Voltar à fila
              </button>
              <h2>
                Laudo da senha {selected.ticket.displayCode ?? "pendente"}
              </h2>
              <p className="urgency" data-level={selected.report.urgencyLevel}>
                Pré-triagem: {urgencyLabels[selected.report.urgencyLevel]}
              </p>
              <p>Especialidades: {selected.report.specialties.join(", ")}</p>
              <ul>
                {selected.report.explanation.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
              <p>Não é diagnóstico. Reavalie o paciente presencialmente.</p>
              <details>
                <summary>Rastreabilidade do laudo</summary>
                <p>Regras: {selected.report.rulesetVersion}</p>
                <p>SHA-256: {selected.report.contentHash}</p>
                <p>
                  {new Date(selected.report.createdAt).toLocaleString("pt-BR")}
                </p>
              </details>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    if (!urgency || !disposition)
                      throw new Error(
                        "Selecione a classificação do hospital e o desfecho.",
                      );
                    await api.recordOutcome(
                      selected.ticket.id,
                      Number(urgency),
                      disposition,
                    );
                    setNotice("Classificação registrada.");
                    setSelected(null);
                    try {
                      setEntries(await api.panelQueue());
                    } catch {
                      setError(
                        "Classificação registrada, mas a fila não pôde ser atualizada. Use Atualizar fila.",
                      );
                    }
                  });
                }}
              >
                <label htmlFor="urgency">Classificação do hospital</label>
                <select
                  id="urgency"
                  value={urgency}
                  onChange={(event) => setUrgency(event.target.value)}
                  required
                >
                  <option value="">Selecione após avaliação</option>
                  {([1, 2, 3, 4, 5] as Urgency[]).map((level) => (
                    <option key={level} value={level}>
                      {level} — {urgencyLabels[level]}
                    </option>
                  ))}
                </select>
                <label htmlFor="disposition">Desfecho</label>
                <select
                  id="disposition"
                  value={disposition}
                  onChange={(event) => setDisposition(event.target.value)}
                  required
                >
                  <option value="">Selecione o desfecho</option>
                  <option value="attended">Atendido</option>
                  <option value="referred">Encaminhado</option>
                  <option value="admitted">Internado</option>
                  <option value="discharged">Alta</option>
                </select>
                <p>
                  Ao registrar, a classificação do hospital passa a prevalecer
                  sobre a pré-triagem.
                </p>
                <button className="action" disabled={busy} type="submit">
                  {busy ? "Registrando…" : "Registrar classificação final"}
                </button>
              </form>
            </section>
          )}
          <button
            disabled={busy}
            onClick={() => {
              clearToken();
              setToken(null);
              setEntries([]);
              setSelected(null);
              setLoaded(false);
              setError("");
              setNotice("");
            }}
          >
            Sair da conta
          </button>
        </>
      )}
      <footer>
        Dados mínimos, acesso restrito. Não copie laudos para sistemas pessoais.
      </footer>
    </main>
  );
}
