// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { PatientApp } from "./PatientApp";

// Usa o renderizador web real também quando o teste é descoberto pela configuração da raiz.
vi.mock("react-native", () => vi.importActual("react-native-web"));
// O gerador nativo de aleatoriedade é substituído pela fronteira Web Crypto do ambiente de teste.
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("OTP usa resposta da API, identifica código de desenvolvimento e exige cadastro após confirmar", async () => {
  vi.stubGlobal("__DEV__", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.endsWith("/auth/otp")
        ? { challengeId: "challenge-1", developmentCode: "654321" }
        : url.endsWith("/auth/verify")
          ? { accessToken: "patient-token", patientId: "patient-1" }
          : url.endsWith("/consents")
            ? []
            : null;
      return new Response(JSON.stringify(body));
    }),
  );
  render(<PatientApp />);
  fireEvent.change(await screen.findByLabelText("Celular com +55 e DDD"), {
    target: { value: "+5511999999999" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Pedir código de acesso" }),
  );
  expect(await screen.findByText(/código sintético 654321/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Código de acesso"), {
    target: { value: "654321" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));
  expect(await screen.findByLabelText("Nome completo")).toBeTruthy();
  expect(screen.getByLabelText("Nascimento (AAAA-MM-DD)")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Preciso de atendimento" }),
  ).toBeNull();
});

test("após retomar alerta de emergência não oferece hospital nem emissão de senha", async () => {
  sessionStorage.setItem("brvital.accessToken", "patient-token");
  sessionStorage.setItem("brvital.sessionId", "session-emergency");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.endsWith("/profile")
        ? {
            fullName: "Pessoa Sintética",
            document: "12345678901",
            birthDate: "1990-01-01",
          }
        : url.endsWith("/consents")
          ? [
              {
                purpose: "triage",
                granted: true,
                policyVersion: "synthetic-2026-11",
              },
            ]
          : url.endsWith("/active")
            ? null
            : {
                sessionId: "session-emergency",
                status: "emergency",
                nextQuestion: null,
                answers: {},
                progress: { answered: 1, total: 5 },
              };
      return new Response(JSON.stringify(body));
    }),
  );
  render(<PatientApp />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Retomar pré-triagem" }),
  );
  expect(await screen.findByText("Procure ajuda agora.")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Ver hospitais recomendados" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Confirmar e solicitar senha" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Emergência · ligar 192" }),
  ).toBeTruthy();
});

test("permite começar nova sessão sem ficar preso ao laudo anterior", async () => {
  sessionStorage.setItem("brvital.accessToken", "patient-token");
  sessionStorage.setItem("brvital.sessionId", "old-session");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.endsWith("/profile")
        ? {
            fullName: "Pessoa Sintética",
            document: "12345678901",
            birthDate: "1990-01-01",
          }
        : url.endsWith("/consents")
          ? [
              {
                purpose: "triage",
                granted: true,
                policyVersion: "synthetic-2026-11",
              },
            ]
          : url.endsWith("/active")
            ? null
            : {
                sessionId: "new-session",
                status: "in_progress",
                nextQuestion: {
                  id: "complaint",
                  text: "Qual é a queixa principal?",
                  options: [{ value: "pain", label: "Dor" }],
                },
                answers: {},
                progress: { answered: 0, total: 5 },
              };
      return new Response(JSON.stringify(body));
    }),
  );
  render(<PatientApp />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Iniciar nova pré-triagem" }),
  );
  expect(await screen.findByText("Qual é a queixa principal?")).toBeTruthy();
  expect(sessionStorage.getItem("brvital.sessionId")).toBe("new-session");
});

test("senha pendente consulta confirmação no primeiro segundo sem antecipar aceite", async () => {
  sessionStorage.setItem("brvital.accessToken", "patient-token");
  const pending = {
    id: "ticket-1",
    reportId: "report-1",
    facilityId: "facility-1",
    status: "sent",
    displayCode: null,
    validUntil: null,
    cancellationPending: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.endsWith("/profile")
        ? {
            fullName: "Pessoa Sintética",
            document: "12345678901",
            birthDate: "1990-01-01",
          }
        : url.endsWith("/consents")
          ? [
              {
                purpose: "triage",
                granted: true,
                policyVersion: "synthetic-2026-11",
              },
            ]
          : url.endsWith("/active")
            ? pending
            : { ...pending, status: "active", displayCode: "DEMO-42" };
      return new Response(JSON.stringify(body));
    }),
  );
  render(<PatientApp />);
  const open = await screen.findByRole("button", { name: "Acompanhar senha" });
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(open);
  });
  expect(
    screen.getByText(/O hospital ainda não confirmou a senha/),
  ).toBeTruthy();
  expect(screen.queryByText("DEMO-42")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText("DEMO-42")).toBeTruthy();
  expect(screen.getByText("Senha confirmada pelo hospital")).toBeTruthy();
});

test("cancelamento pendente não é apresentado como senha cancelada", async () => {
  sessionStorage.setItem("brvital.accessToken", "patient-token");
  const active = {
    id: "ticket-1",
    reportId: "report-1",
    facilityId: "facility-1",
    status: "active",
    displayCode: "DEMO-88",
    validUntil: null,
    cancellationPending: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.endsWith("/profile")
        ? {
            fullName: "Pessoa Sintética",
            document: "12345678901",
            birthDate: "1990-01-01",
          }
        : url.endsWith("/consents")
          ? [
              {
                purpose: "triage",
                granted: true,
                policyVersion: "synthetic-2026-11",
              },
            ]
          : url.endsWith("/cancel")
            ? { ...active, cancellationPending: true }
            : active;
      return new Response(JSON.stringify(body));
    }),
  );
  render(<PatientApp />);
  const open = await screen.findByRole("button", { name: "Acompanhar senha" });
  await act(async () => {
    fireEvent.click(open);
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancelar senha" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar cancelamento" }),
  );
  expect(
    await screen.findByText(
      /Cancelamento solicitado, aguardando confirmação do hospital/,
    ),
  ).toBeTruthy();
  expect(screen.queryByText("Senha cancelada")).toBeNull();
});

test("corrigir uma resposta usa a próxima pergunta recalculada pela API", async () => {
  sessionStorage.setItem("brvital.accessToken", "patient-token");
  const complaint = {
    id: "complaint",
    text: "Qual é sua queixa?",
    options: [
      { value: "pain", label: "Dor" },
      { value: "other", label: "Outro desconforto" },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/profile"))
        return new Response(
          JSON.stringify({
            fullName: "Pessoa Sintética",
            document: "12345678901",
            birthDate: "1990-01-01",
          }),
        );
      if (url.endsWith("/consents"))
        return new Response(
          JSON.stringify([
            {
              purpose: "triage",
              granted: true,
              policyVersion: "synthetic-2026-11",
            },
          ]),
        );
      if (url.endsWith("/active")) return new Response("null");
      const answer = init?.body
        ? (JSON.parse(String(init.body)) as { value: string })
        : null;
      const nextQuestion = !answer
        ? complaint
        : answer.value === "pain"
          ? {
              id: "pain",
              text: "Onde dói?",
              options: [{ value: "chest", label: "Peito" }],
            }
          : {
              id: "duration",
              text: "Há quanto tempo começou?",
              options: [{ value: "today", label: "Hoje" }],
            };
      return new Response(
        JSON.stringify({
          sessionId: "session-edit",
          status: "in_progress",
          answers: answer ? { complaint: answer.value } : {},
          nextQuestion,
          progress: { answered: answer ? 1 : 0, total: 5 },
        }),
      );
    }),
  );
  render(<PatientApp />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Preciso de atendimento" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Dor" }));
  expect(await screen.findByText("Onde dói?")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Voltar à pergunta anterior" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Outro desconforto" }));
  expect(await screen.findByText("Há quanto tempo começou?")).toBeTruthy();
  expect(screen.queryByText("Onde dói?")).toBeNull();
});
