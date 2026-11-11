import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Platform,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import {
  createApi,
  policyVersion,
  profileSchema,
  syntheticWarning,
  urgencyLabels,
  type Consent,
  type Profile,
  type Question,
  type Recommendation,
  type Session,
  type Ticket,
  type TicketStatus,
  type TriageReport,
} from "@brvital/contracts";
import {
  createPatient,
  createTokenSession,
  sessionScreen,
  type SessionScreen,
} from "./patient";
import { privateStorage } from "./storage";
import { Button, Card, Copy, Field, Title, colors, styles } from "./ui";

type Screen =
  | "login"
  | "profile"
  | "consent"
  | "home"
  | SessionScreen
  | "recommendations"
  | "confirmation"
  | "ticket"
  | "privacy";
const baseUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const blankProfile: Profile = { fullName: "", document: "", birthDate: "" };
const ticketLabels: Record<TicketStatus, string> = {
  requested: "Solicitação recebida; aguardando envio ao hospital",
  sent: "Enviada; aguardando confirmação do hospital",
  active: "Senha confirmada pelo hospital",
  rejected: "Hospital recusou a solicitação",
  failed: "Não foi possível emitir a senha",
  cancelled: "Senha cancelada",
  expired: "Senha expirada",
  attended: "Atendimento registrado",
  no_show: "Comparecimento não registrado",
};
const isPending = (ticket: Ticket) =>
  ticket.status === "requested" || ticket.status === "sent";
const canPoll = (ticket: Ticket) =>
  isPending(ticket) || ticket.status === "active" || ticket.cancellationPending;
const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "Não informado";

export function PatientApp() {
  const auth = useMemo(() => createTokenSession(privateStorage), []);
  const api = useMemo(() => createApi(baseUrl, auth.token), [auth]);
  const patient = useMemo(() => createPatient(api, privateStorage), [api]);
  const [screen, setScreen] = useState<Screen>("login");
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");
  const [code, setCode] = useState("");
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [registered, setRegistered] = useState(false);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [triageConsent, setTriageConsent] = useState(false);
  const [shareConsent, setShareConsent] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [hasResume, setHasResume] = useState(false);
  const [history, setHistory] = useState<Question[]>([]);
  const [editing, setEditing] = useState<Question | null>(null);
  const [report, setReport] = useState<TriageReport | null>(null);
  const [area, setArea] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [facilities, setFacilities] = useState<Recommendation[]>([]);
  const [searched, setSearched] = useState(false);
  const [facility, setFacility] = useState<Recommendation | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [eraseConfirm, setEraseConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "Não foi possível concluir."} Confira sua conexão e tente novamente.`,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  const granted = (purpose: Consent["purpose"]) =>
    consents.some(
      (consent) =>
        consent.purpose === purpose &&
        consent.granted &&
        consent.policyVersion === policyVersion,
    );
  async function loadAccount() {
    const [savedProfile, savedConsents, savedTicket, savedSessionId] =
      await Promise.all([
        api.profile(),
        api.consents(),
        api.activeTicket(),
        privateStorage.get("sessionId"),
      ]);
    setProfile(savedProfile ?? blankProfile);
    setRegistered(!!savedProfile);
    setConsents(savedConsents);
    setTriageConsent(
      savedConsents.some(
        (c) =>
          c.purpose === "triage" &&
          c.granted &&
          c.policyVersion === policyVersion,
      ),
    );
    setShareConsent(
      savedConsents.some(
        (c) =>
          c.purpose === "share_with_facility" &&
          c.granted &&
          c.policyVersion === policyVersion,
      ),
    );
    setTicket(savedTicket);
    setHasResume(!!savedSessionId);
    setScreen(
      !savedProfile
        ? "profile"
        : savedConsents.some(
              (c) =>
                c.purpose === "triage" &&
                c.granted &&
                c.policyVersion === policyVersion,
            )
          ? "home"
          : "consent",
    );
  }
  useEffect(() => {
    void run(async () => {
      try {
        if (await auth.restore()) {
          setSignedIn(true);
          await loadAccount();
        }
      } finally {
        setReady(true);
      }
    });
    // As credenciais são restauradas uma vez por montagem.
  }, []);

  async function startFresh() {
    if (!registered) {
      setScreen("profile");
      return;
    }
    if (!granted("triage")) {
      setScreen("consent");
      return;
    }
    if (ticket && canPoll(ticket)) {
      setScreen("ticket");
      return;
    }
    const started = await patient.start();
    setHasResume(true);
    setHistory([]);
    setReport(null);
    setFacilities([]);
    setFacility(null);
    setIdempotencyKey("");
    setTicket(null);
    await showSession(started.session);
  }
  async function showSession(value: Session) {
    setSession(value);
    setEditing(null);
    const destination = sessionScreen(value);
    setScreen(destination);
    if (destination === "report") setReport(await api.report(value.sessionId));
  }
  useEffect(() => {
    if (screen !== "ticket" || !ticket || !canPoll(ticket)) return;
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const updated = await api.ticket(ticket.id);
        if (!disposed) {
          setTicket(updated);
          setError("");
        }
      } catch (err) {
        if (!disposed)
          setError(
            `${err instanceof Error ? err.message : "Falha ao atualizar a senha."} Use Atualizar agora ou volte mais tarde.`,
          );
      } finally {
        inFlight = false;
      }
    };
    const interval = setInterval(() => {
      void refresh();
    }, isPending(ticket) ? 1000 : 5000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [screen, ticket?.id, ticket?.status, ticket?.cancellationPending, api]);

  async function saveProfile() {
    const result = profileSchema.safeParse(profile);
    if (!result.success)
      throw new Error(
        "Informe nome completo, CPF com 11 dígitos ou CNS com 15, e nascimento no formato AAAA-MM-DD.",
      );
    const birth = new Date(`${result.data.birthDate}T00:00:00`);
    const adultDate = new Date();
    adultDate.setFullYear(adultDate.getFullYear() - 18);
    if (birth > adultDate)
      throw new Error(
        "Esta demonstração é exclusiva para adultos com 18 anos ou mais.",
      );
    const saved = await api.saveProfile(result.data);
    setProfile(saved);
    setRegistered(true);
    if (screen === "profile") setScreen("consent");
    else setNotice("Cadastro atualizado.");
  }
  async function openTicket() {
    setCancelConfirm(false);
    setScreen("ticket");
    if (
      !ticket ||
      (report?.id === ticket.reportId &&
        facility?.facilityId === ticket.facilityId)
    )
      return;
    const restored = await patient.resume();
    if (!restored || sessionScreen(restored.session) !== "report") return;
    const savedReport = await api.report(restored.session.sessionId);
    if (savedReport.id !== ticket.reportId) return;
    setSession(restored.session);
    setReport(savedReport);
    const units = await api.recommendations(restored.session.sessionId, {
      area: area.trim() || "São Paulo",
    });
    setFacilities(units);
    setFacility(
      units.find((unit) => unit.facilityId === ticket.facilityId) ?? null,
    );
  }
  async function findFacilities(location: {
    lat?: number;
    lng?: number;
    area?: string;
  }) {
    if (!session || !report || sessionScreen(session) === "emergency")
      throw new Error(
        "Retome uma pré-triagem concluída antes de buscar unidades.",
      );
    setFacilities(await api.recommendations(session.sessionId, location));
    setSearched(true);
  }
  async function searchByCoordinates() {
    const lat = Number(latitude.replace(",", "."));
    const lng = Number(longitude.replace(",", "."));
    if (
      !latitude.trim() ||
      !longitude.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      throw new Error(
        "Informe latitude e longitude válidas ou busque pelo bairro ou CEP.",
      );
    await findFacilities({ lat, lng });
  }
  async function locate() {
    if (Platform.OS !== "web" || !navigator.geolocation)
      throw new Error(
        "Localização automática indisponível. Informe seu bairro ou CEP, ou as coordenadas.",
      );
    const position = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        resolve,
        () =>
          reject(
            new Error(
              "Localização negada ou indisponível. Busque pelo bairro ou CEP.",
            ),
          ),
        { timeout: 10000, maximumAge: 60000 },
      ),
    );
    setLatitude(String(position.coords.latitude));
    setLongitude(String(position.coords.longitude));
    await findFacilities({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    });
  }
  async function logout() {
    try {
      await auth.signOut();
    } finally {
      setSignedIn(false);
      setProfile(blankProfile);
      setRegistered(false);
      setConsents([]);
      setTriageConsent(false);
      setShareConsent(false);
      setSession(null);
      setReport(null);
      setTicket(null);
      setFacilities([]);
      setFacility(null);
      setHasResume(false);
      setHistory([]);
      setEditing(null);
      setPhone("");
      setCode("");
      setChallenge("");
      setDevelopmentCode("");
      setArea("");
      setLatitude("");
      setLongitude("");
      setIdempotencyKey("");
      setScreen("login");
    }
  }
  function profileFields() {
    return (
      <>
        <Field
          label="Nome completo"
          autoCapitalize="words"
          value={profile.fullName}
          onChangeText={(fullName) => setProfile({ ...profile, fullName })}
          textContentType="name"
        />
        <Field
          label="CPF ou CNS (somente números)"
          keyboardType="number-pad"
          value={profile.document}
          onChangeText={(document) => setProfile({ ...profile, document })}
          maxLength={15}
        />
        <Field
          label="Nascimento (AAAA-MM-DD)"
          value={profile.birthDate}
          onChangeText={(birthDate) => setProfile({ ...profile, birthDate })}
          placeholder="1990-01-31"
          maxLength={10}
        />
        <Button primary disabled={busy} onPress={() => void run(saveProfile)}>
          {screen === "profile"
            ? "Salvar cadastro e continuar"
            : "Salvar cadastro"}
        </Button>
      </>
    );
  }
  function reportSummary() {
    if (!report) return null;
    return (
      <Card>
        <View
          style={{
            borderLeftWidth: 4,
            borderColor:
              report.urgencyLevel <= 2
                ? colors.danger
                : report.urgencyLevel === 3
                  ? "#E8B923"
                  : colors.green,
            paddingLeft: 14,
          }}
        >
          <Title question>{urgencyLabels[report.urgencyLevel]}</Title>
          <Copy>Especialidades: {report.specialties.join(", ")}</Copy>
          {report.explanation.map((reason, index) => (
            <Copy key={index}>• {reason}</Copy>
          ))}
        </View>
        <Copy>
          Não é diagnóstico. O hospital reavalia e sua classificação sempre
          prevalece.
        </Copy>
        <Copy muted>
          Regras {report.rulesetVersion} · {dateTime(report.createdAt)}
        </Copy>
      </Card>
    );
  }
  const question = editing ?? session?.nextQuestion;
  const displayFacility =
    facility?.facilityId === ticket?.facilityId
      ? facility
      : facilities.find((item) => item.facilityId === ticket?.facilityId);

  return (
    <View style={styles.column}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Copy muted>BR Vital · demonstração</Copy>
        <View style={styles.warning}>
          <Copy>{syntheticWarning}</Copy>
        </View>
        {Platform.OS === "web" && (
          <Copy muted>
            Acesso web: sua sessão fica somente nesta aba e é acessível a
            scripts da página. Feche a aba ou saia ao terminar; não use dados
            reais.
          </Copy>
        )}
        {signedIn &&
          screen !== "emergency" &&
          screen !== "home" &&
          screen !== "profile" && (
            <Button
              disabled={busy}
              onPress={() => {
                setScreen("home");
                setError("");
                setNotice("");
              }}
            >
              Ir ao início
            </Button>
          )}
        {!!error && (
          <View accessibilityRole="alert" style={styles.error}>
            <Copy>{error}</Copy>
            {signedIn && screen !== "emergency" && (
              <Button disabled={busy} onPress={() => void run(loadAccount)}>
                Recarregar minha conta
              </Button>
            )}
          </View>
        )}
        {!!notice && (
          <View accessibilityLiveRegion="polite">
            <Copy>{notice}</Copy>
          </View>
        )}
        {busy && (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            Aguarde, processando…
          </Text>
        )}
        {!ready ? (
          <Copy>Restaurando acesso…</Copy>
        ) : (
          <>
            {screen === "login" && (
              <>
                <Title>Cuidado começa com orientação.</Title>
                <Copy>
                  Pré-triagem guiada para adultos em São Paulo. Não substitui
                  avaliação médica.
                </Copy>
                {!challenge ? (
                  <>
                    <Field
                      label="Celular com +55 e DDD"
                      keyboardType="phone-pad"
                      textContentType="telephoneNumber"
                      placeholder="+5511999999999"
                      value={phone}
                      onChangeText={setPhone}
                    />
                    <Button
                      primary
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          if (!/^\+55\d{10,11}$/.test(phone))
                            throw new Error(
                              "Informe celular brasileiro com +55 e DDD, sem espaços.",
                            );
                          const result = await api.requestOtp(phone);
                          setChallenge(result.challengeId);
                          setDevelopmentCode(
                            __DEV__ ||
                              process.env.EXPO_PUBLIC_SYNTHETIC_AUTH === "true"
                              ? (result.developmentCode ?? "")
                              : "",
                          );
                        })
                      }
                    >
                      Pedir código de acesso
                    </Button>
                  </>
                ) : (
                  <>
                    <Copy>
                      Confirme o código de acesso do celular informado.
                    </Copy>
                    {!!developmentCode && (
                      <View style={styles.warning}>
                        <Copy>
                          Somente desenvolvimento: código sintético{" "}
                          {developmentCode}. Não houve envio de SMS.
                        </Copy>
                      </View>
                    )}
                    <Field
                      label="Código de acesso"
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      value={code}
                      onChangeText={setCode}
                      maxLength={6}
                    />
                    <Button
                      primary
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          if (!/^\d{6}$/.test(code))
                            throw new Error(
                              "Informe os 6 dígitos do código de acesso.",
                            );
                          const result = await api.verifyOtp(challenge, code);
                          await auth.signIn(result.accessToken);
                          setSignedIn(true);
                          setCode("");
                          setChallenge("");
                          setDevelopmentCode("");
                          await loadAccount();
                        })
                      }
                    >
                      Confirmar código
                    </Button>
                    <Button
                      disabled={busy}
                      onPress={() => {
                        setChallenge("");
                        setCode("");
                        setDevelopmentCode("");
                      }}
                    >
                      Trocar celular ou pedir novo código
                    </Button>
                  </>
                )}
              </>
            )}
            {screen === "profile" && (
              <>
                <Title>Seu cadastro</Title>
                <Copy>
                  Informe dados fictícios. Nome, documento e nascimento
                  identificam o paciente; não guardamos um perfil de saúde neste
                  aparelho.
                </Copy>
                {profileFields()}
                <Button disabled={busy} onPress={() => void run(logout)}>
                  Sair
                </Button>
              </>
            )}
            {screen === "consent" && (
              <>
                <Title>Você controla seus dados.</Title>
                <Copy>
                  A pré-triagem segue regras objetivas, não faz diagnóstico e
                  não substitui o hospital.
                </Copy>
                <View style={styles.switchRow}>
                  <Copy>
                    Autorizo o uso das respostas para realizar a pré-triagem.
                  </Copy>
                  <Switch
                    accessibilityLabel="Consentimento para triagem"
                    value={triageConsent}
                    onValueChange={setTriageConsent}
                    disabled={busy}
                    trackColor={{ true: colors.green }}
                  />
                </View>
                <View style={styles.switchRow}>
                  <Copy>
                    Autorizo compartilhar minha identificação e laudo somente
                    com o hospital que eu escolher. É opcional para fazer a
                    pré-triagem.
                  </Copy>
                  <Switch
                    accessibilityLabel="Consentimento para compartilhar com hospital"
                    value={shareConsent}
                    onValueChange={setShareConsent}
                    disabled={busy}
                    trackColor={{ true: colors.green }}
                  />
                </View>
                <Copy muted>
                  Política {policyVersion}. Você pode revogar cada autorização
                  em Perfil e privacidade.
                </Copy>
                <Button
                  primary
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      setConsents(
                        await api.setConsent("triage", triageConsent),
                      );
                      setConsents(
                        await api.setConsent(
                          "share_with_facility",
                          shareConsent,
                        ),
                      );
                      setScreen("home");
                    })
                  }
                >
                  Salvar minhas escolhas
                </Button>
              </>
            )}
            {screen === "home" && (
              <>
                <Title>Como podemos orientar?</Title>
                <Copy>
                  Responda uma pergunta por vez. Em caso de gravidade, não
                  espere pela pré-triagem.
                </Copy>
                {ticket && (
                  <Card>
                    <Copy>
                      Minha senha: {ticket.displayCode ?? "aguardando hospital"}
                    </Copy>
                    <Copy>{ticketLabels[ticket.status]}</Copy>
                    <Button
                      disabled={busy}
                      onPress={() => void run(openTicket)}
                    >
                      Acompanhar senha
                    </Button>
                  </Card>
                )}
                <Button
                  primary
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      if (!registered) {
                        setScreen("profile");
                        return;
                      }
                      if (!granted("triage")) {
                        setScreen("consent");
                        return;
                      }
                      if (ticket && canPoll(ticket)) {
                        setScreen("ticket");
                        return;
                      }
                      if (hasResume) {
                        const restored = await patient.resume();
                        if (restored) {
                          setHistory([]);
                          await showSession(restored.session);
                          return;
                        }
                      }
                      await startFresh();
                    })
                  }
                >
                  {hasResume ? "Retomar pré-triagem" : "Preciso de atendimento"}
                </Button>
                {hasResume && (!ticket || !canPoll(ticket)) && (
                  <>
                    <Copy muted>
                      Uma nova sessão não altera o laudo anterior. A retomada
                      neste aparelho passará a usar a nova sessão.
                    </Copy>
                    <Button
                      disabled={busy}
                      onPress={() => void run(startFresh)}
                    >
                      Iniciar nova pré-triagem
                    </Button>
                  </>
                )}
                <Button
                  disabled={busy}
                  onPress={() => {
                    setEraseConfirm(false);
                    setScreen("privacy");
                  }}
                >
                  Perfil e privacidade
                </Button>
              </>
            )}
            {screen === "questionnaire" && session && (
              <>
                <Title>Uma pergunta por vez.</Title>
                <Copy>
                  Perguntas respondidas: {session.progress.answered} de{" "}
                  {session.progress.total}
                </Copy>
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: session.progress.total,
                    now: session.progress.answered,
                  }}
                  style={styles.progress}
                >
                  <View
                    style={{
                      height: 8,
                      backgroundColor: colors.green,
                      width: `${Math.min(100, session.progress.total ? (session.progress.answered / session.progress.total) * 100 : 0)}%`,
                    }}
                  />
                </View>
                {question ? (
                  <>
                    <Title question>{question.text}</Title>
                    {editing && (
                      <Copy>
                        Escolha uma resposta para corrigir esta etapa. As
                        próximas perguntas serão recalculadas.
                      </Copy>
                    )}
                    {question.options.map((option) => (
                      <Button
                        key={option.value}
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            const updated = await api.answer(
                              session.sessionId,
                              question.id,
                              option.value,
                            );
                            setHistory((previous) => {
                              const index = previous.findIndex(
                                (item) => item.id === question.id,
                              );
                              return [
                                ...(index < 0
                                  ? previous
                                  : previous.slice(0, index)),
                                question,
                              ];
                            });
                            await showSession(updated);
                          })
                        }
                      >
                        {option.label}
                      </Button>
                    ))}
                    {!!history.length && (
                      <Button
                        disabled={busy}
                        onPress={() => {
                          const index = editing
                            ? history.findIndex(
                                (item) => item.id === editing.id,
                              ) - 1
                            : history.length - 1;
                          const previous = history[index];
                          if (previous) setEditing(previous);
                        }}
                      >
                        {editing && history[0]?.id === editing.id
                          ? "Primeira pergunta"
                          : "Voltar à pergunta anterior"}
                      </Button>
                    )}
                    {editing && (
                      <Button disabled={busy} onPress={() => setEditing(null)}>
                        Manter respostas e continuar
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Copy>Não foi possível obter a próxima pergunta.</Copy>
                    <Button
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          await showSession(
                            await api.session(session.sessionId),
                          );
                        })
                      }
                    >
                      Tentar retomar questionário
                    </Button>
                  </>
                )}
                <Copy muted>
                  Respostas ficam na sessão da API. Neste aparelho guardamos
                  apenas a credencial e o identificador da sessão para retomar.
                </Copy>
              </>
            )}
            {screen === "emergency" && (
              <>
                <Title>Procure ajuda agora.</Title>
                <View style={styles.error}>
                  <Copy>
                    Suas respostas acionaram um alerta de emergência. Ligue 192
                    e siga a orientação do SAMU. Não espere por uma senha.
                  </Copy>
                </View>
                <Copy>
                  Informe ao atendente onde você está. Endereço aproximado:{" "}
                  {area.trim() ||
                    (latitude && longitude
                      ? `${latitude}, ${longitude}`
                      : "não disponível; confirme sua localização ao telefone")}
                  .
                </Copy>
                <Copy>
                  O fluxo foi interrompido. Não emitiremos senha nem
                  recomendaremos hospital para esta sessão.
                </Copy>
                <Button
                  primary
                  onPress={() =>
                    void run(async () => {
                      await Linking.openURL("tel:192");
                    })
                  }
                >
                  Ligar para o SAMU · 192
                </Button>
              </>
            )}
            {screen === "report" && (
              <>
                <Title>Seu laudo de pré-triagem</Title>
                {reportSummary()}
                {!report && session && (
                  <Button
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        setReport(await api.report(session.sessionId));
                      })
                    }
                  >
                    Carregar laudo
                  </Button>
                )}
                {report && (
                  <>
                    <Copy muted>Identificador: {report.id}</Copy>
                    <Copy muted>SHA-256: {report.contentHash}</Copy>
                    <Button
                      primary
                      disabled={busy}
                      onPress={() => {
                        setSearched(false);
                        setScreen("recommendations");
                      }}
                    >
                      Ver hospitais recomendados
                    </Button>
                  </>
                )}
              </>
            )}
            {screen === "recommendations" && (
              <>
                <Title>Para onde ir</Title>
                <Copy>
                  Unidades da rede sintética de São Paulo. Use sua localização
                  ou informe bairro/CEP.
                </Copy>
                <Button disabled={busy} onPress={() => void run(locate)}>
                  Usar localização neste navegador
                </Button>
                <Field
                  label="Bairro ou CEP de São Paulo"
                  value={area}
                  onChangeText={setArea}
                  placeholder="Ex.: Bela Vista ou 01310-100"
                />
                <Button
                  primary
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      if (!area.trim())
                        throw new Error(
                          "Informe um bairro ou CEP de São Paulo.",
                        );
                      await findFacilities({ area: area.trim() });
                    })
                  }
                >
                  Buscar pelo bairro ou CEP
                </Button>
                <Copy muted>
                  Se preferir, informe coordenadas. No celular, esta opção
                  dispensa permissão de localização.
                </Copy>
                <Field
                  label="Latitude"
                  keyboardType="numbers-and-punctuation"
                  value={latitude}
                  onChangeText={setLatitude}
                  placeholder="-23.55"
                />
                <Field
                  label="Longitude"
                  keyboardType="numbers-and-punctuation"
                  value={longitude}
                  onChangeText={setLongitude}
                  placeholder="-46.63"
                />
                <Button
                  disabled={busy}
                  onPress={() => void run(searchByCoordinates)}
                >
                  Buscar pelas coordenadas
                </Button>
                {searched && !facilities.length && (
                  <Copy>
                    Nenhuma unidade compatível disponível. Tente outro bairro ou
                    procure orientação presencial; não espere se os sintomas
                    piorarem.
                  </Copy>
                )}
                {facilities.map((item) => (
                  <Card key={item.facilityId}>
                    <Title question>{item.name}</Title>
                    <Copy>{item.address}</Copy>
                    <Copy>{item.specialties.join(", ")}</Copy>
                    <Copy>
                      {item.distanceKm.toLocaleString("pt-BR")} km ·
                      deslocamento:{" "}
                      {item.travelMinutes === null
                        ? "não disponível"
                        : `${item.travelMinutes} min`}
                    </Copy>
                    <Copy>
                      Espera estimada:{" "}
                      {item.waitMinutes === null
                        ? "sem dado confiável"
                        : `${item.waitMinutes} min`}
                    </Copy>
                    <Copy muted>
                      Atualização da unidade: {dateTime(item.statusUpdatedAt)}.
                      Estimativas não garantem horário de atendimento.
                    </Copy>
                    <Button
                      disabled={busy}
                      onPress={() => {
                        setFacility(item);
                        setIdempotencyKey(Crypto.randomUUID());
                        setScreen("confirmation");
                      }}
                    >
                      Escolher {item.name}
                    </Button>
                  </Card>
                ))}
              </>
            )}
            {screen === "confirmation" && facility && report && (
              <>
                <Title>Confirmar compartilhamento</Title>
                <Card>
                  <Title question>{facility.name}</Title>
                  <Copy>{facility.address}</Copy>
                  <Copy>
                    Serão enviados: nome, documento, nascimento, nível de
                    urgência e laudo de pré-triagem. Nenhum envio acontece antes
                    desta confirmação.
                  </Copy>
                  <Copy>
                    Prioridade inicial: {urgencyLabels[report.urgencyLevel]}. O
                    hospital reavalia na chegada.
                  </Copy>
                </Card>
                <View style={styles.switchRow}>
                  <Copy>
                    Autorizo compartilhar esses dados com esta unidade.
                  </Copy>
                  <Switch
                    accessibilityLabel="Autorizar compartilhamento com a unidade escolhida"
                    value={shareConsent}
                    onValueChange={setShareConsent}
                    disabled={busy}
                    trackColor={{ true: colors.green }}
                  />
                </View>
                <Button
                  primary
                  disabled={busy || !shareConsent}
                  onPress={() =>
                    void run(async () => {
                      if (!session || sessionScreen(session) === "emergency")
                        throw new Error(
                          "Esta sessão não permite emissão de senha.",
                        );
                      if (!shareConsent)
                        throw new Error(
                          "Autorize o compartilhamento antes de emitir.",
                        );
                      setConsents(
                        await api.setConsent("share_with_facility", true),
                      );
                      const created = await api.issueTicket(
                        report.id,
                        facility.facilityId,
                        idempotencyKey,
                      );
                      setTicket(created);
                      setCancelConfirm(false);
                      setScreen("ticket");
                    })
                  }
                >
                  Confirmar e solicitar senha
                </Button>
                <Copy muted>
                  Você verá o estado do envio. Só há senha confirmada quando o
                  hospital responder.
                </Copy>
                <Button
                  disabled={busy}
                  onPress={() => setScreen("recommendations")}
                >
                  Escolher outra unidade
                </Button>
              </>
            )}
            {screen === "ticket" && ticket && (
              <>
                <Title>Sua senha</Title>
                <Card>
                  <Text style={styles.code}>
                    {ticket.displayCode ?? "Pendente"}
                  </Text>
                  <Copy>{ticketLabels[ticket.status]}</Copy>
                  {ticket.cancellationPending && (
                    <Copy>
                      Cancelamento solicitado, aguardando confirmação do
                      hospital. Sua senha ainda não está cancelada.
                    </Copy>
                  )}
                  <Copy>Validade: {dateTime(ticket.validUntil)}</Copy>
                  <Copy>
                    {displayFacility?.name ??
                      `Unidade selecionada: ${ticket.facilityId}`}
                  </Copy>
                  {displayFacility && <Copy>{displayFacility.address}</Copy>}
                </Card>
                {isPending(ticket) && (
                  <View style={styles.warning}>
                    <Copy>
                      O hospital ainda não confirmou a senha. Consultamos a cada
                      segundo durante a emissão; não considere a solicitação uma vaga
                      garantida. Você pode voltar mais tarde. O cancelamento
                      fica disponível após a confirmação.
                    </Copy>
                  </View>
                )}
                <Button
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      setTicket(await api.ticket(ticket.id));
                    })
                  }
                >
                  Atualizar agora
                </Button>
                <Button disabled={busy} onPress={() => setScreen("home")}>
                  Voltar e consultar mais tarde
                </Button>
                {ticket.status === "active" && (
                  <Button
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        const destination = displayFacility
                          ? `${displayFacility.latitude},${displayFacility.longitude}`
                          : facility?.address;
                        if (!destination)
                          throw new Error(
                            "Endereço da unidade indisponível nesta retomada. Consulte a unidade pelo identificador exibido.",
                          );
                        await Linking.openURL(
                          `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
                        );
                      })
                    }
                  >
                    Navegar até a unidade
                  </Button>
                )}
                {report && report.id === ticket.reportId && reportSummary()}
                {(ticket.status === "failed" ||
                  ticket.status === "rejected") && (
                  <>
                    <View style={styles.error}>
                      <Copy>
                        {ticket.failureReason ??
                          "A unidade não confirmou sua senha."}
                      </Copy>
                    </View>
                    <Button
                      primary
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          const restored = await patient.resume();
                          if (!restored)
                            throw new Error(
                              "Retome sua sessão para buscar outra unidade.",
                            );
                          await showSession(restored.session);
                          if (sessionScreen(restored.session) !== "report")
                            return;
                          setFacilities((previous) =>
                            previous.filter(
                              (item) => item.facilityId !== ticket.facilityId,
                            ),
                          );
                          setSearched(false);
                          setScreen("recommendations");
                        })
                      }
                    >
                      Buscar outra unidade
                    </Button>
                  </>
                )}
                {ticket.status === "expired" && (
                  <Copy>
                    A validade terminou. Esta senha não garante atendimento na
                    fila. Procure a recepção; em emergência, ligue 192.
                  </Copy>
                )}
                {ticket.status === "active" && !ticket.cancellationPending && (
                  <>
                    <Button
                      danger
                      disabled={busy}
                      onPress={() => setCancelConfirm((value) => !value)}
                    >
                      {cancelConfirm ? "Manter minha senha" : "Cancelar senha"}
                    </Button>
                    {cancelConfirm && (
                      <>
                        <Copy>
                          Confirmar desistência? O pedido de cancelamento será
                          enviado ao hospital.
                        </Copy>
                        <Button
                          danger
                          disabled={busy}
                          onPress={() =>
                            void run(async () => {
                              setTicket(await api.cancelTicket(ticket.id));
                              setCancelConfirm(false);
                            })
                          }
                        >
                          Confirmar cancelamento
                        </Button>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {screen === "privacy" && (
              <>
                <Title>Perfil e privacidade</Title>
                <Copy>
                  Cadastro de identificação. Não há perfil de saúde salvo no
                  aparelho.
                </Copy>
                {profileFields()}
                <Title question>Consentimentos</Title>
                {(["triage", "share_with_facility"] as const).map((purpose) => (
                  <Card key={purpose}>
                    <Copy>
                      {purpose === "triage"
                        ? "Uso de respostas para pré-triagem"
                        : "Compartilhamento com o hospital"}
                      : {granted(purpose) ? "autorizado" : "não autorizado"}
                    </Copy>
                    {granted(purpose) && (
                      <Button
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            setConsents(await api.setConsent(purpose, false));
                            if (purpose === "triage") setTriageConsent(false);
                            else setShareConsent(false);
                            setNotice(
                              "Consentimento revogado. Dados já enviados seguem as obrigações legais da unidade.",
                            );
                          })
                        }
                      >
                        Revogar{" "}
                        {purpose === "triage" ? "triagem" : "compartilhamento"}
                      </Button>
                    )}
                  </Card>
                ))}
                <Button disabled={busy} onPress={() => setScreen("consent")}>
                  Revisar todas as autorizações
                </Button>
                <Title question>Seus direitos</Title>
                <Copy>
                  Recebemos o pedido agora. A exportação ou exclusão será
                  processada pela equipe, com as retenções legais aplicáveis;
                  não é instantânea.
                </Copy>
                <Button
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      const receipt = await api.privacyRequest("export");
                      setNotice(
                        `Pedido de exportação recebido: ${receipt.requestId}. Prazo de resposta: ${dateTime(receipt.dueAt)}.`,
                      );
                    })
                  }
                >
                  Solicitar exportação dos dados
                </Button>
                <Button
                  danger
                  disabled={busy}
                  onPress={() => setEraseConfirm((value) => !value)}
                >
                  {eraseConfirm
                    ? "Não pedir exclusão"
                    : "Solicitar exclusão dos dados"}
                </Button>
                {eraseConfirm && (
                  <>
                    <Copy>
                      Confirma o pedido de exclusão? A equipe analisará a
                      anonimização e as retenções obrigatórias.
                    </Copy>
                    <Button
                      danger
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          const receipt = await api.privacyRequest("erase");
                          setEraseConfirm(false);
                          setNotice(
                            `Pedido de exclusão recebido: ${receipt.requestId}. Prazo de resposta: ${dateTime(receipt.dueAt)}. Os dados ainda não foram excluídos.`,
                          );
                        })
                      }
                    >
                      Confirmar pedido de exclusão
                    </Button>
                  </>
                )}
                <Button disabled={busy} onPress={() => void run(logout)}>
                  Sair e limpar acesso deste aparelho
                </Button>
              </>
            )}
          </>
        )}
      </ScrollView>
      <View style={styles.emergency}>
        <Button
          danger
          onPress={() => {
            void Linking.openURL("tel:192").catch(() =>
              setError(
                "Não foi possível abrir o telefone. Ligue 192 manualmente.",
              ),
            );
          }}
        >
          Emergência · ligar 192
        </Button>
      </View>
    </View>
  );
}
