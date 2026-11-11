// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

test("sem autenticação não consulta a fila e oferece acesso sintético explícito", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<App development />);
  expect(
    screen.getByRole("button", { name: "Entrar na demonstração sintética" }),
  ).toBeTruthy();
  expect(screen.getByText(/sem validade clínica/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

test("registra classificação hospitalar apenas após confirmação da API", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/outcome"))
        return new Response(
          JSON.stringify({ message: "Serviço indisponível. Tente novamente." }),
          { status: 503 },
        );
      return new Response(
        JSON.stringify([
          {
            ticket: {
              id: "ticket-1",
              displayCode: "DEMO-01",
              status: "active",
            },
            report: {
              id: "report-1",
              urgencyLevel: 3,
              specialties: ["Clínica médica"],
              explanation: ["Resposta sintética"],
              rulesetVersion: "demo-1",
              contentHash: "abc",
              createdAt: "2026-11-11T12:00:00Z",
            },
          },
        ]),
      );
    }),
  );
  render(<App initialToken="staff-token" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Abrir laudo DEMO-01" }),
  );
  fireEvent.change(screen.getByLabelText("Classificação do hospital"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Desfecho"), {
    target: { value: "attended" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Registrar classificação final" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Serviço indisponível. Tente novamente.",
  );
  expect(screen.queryByText("Classificação registrada.")).toBeNull();
});

test("registra a classificação escolhida no hospital e só então confirma o desfecho", async () => {
  let recorded = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/outcome")) {
        const body = JSON.parse(String(init?.body)) as {
          urgencyLevel: number;
          disposition: string;
        };
        if (body.urgencyLevel !== 2 || body.disposition !== "referred")
          return new Response(
            JSON.stringify({ message: "Desfecho inesperado" }),
            { status: 400 },
          );
        recorded = true;
        return new Response(JSON.stringify({ recorded: true }));
      }
      return new Response(
        JSON.stringify(
          recorded
            ? []
            : [
                {
                  ticket: {
                    id: "ticket-2",
                    displayCode: "DEMO-02",
                    status: "active",
                  },
                  report: {
                    id: "report-2",
                    urgencyLevel: 4,
                    specialties: ["Clínica médica"],
                    explanation: ["Resposta sintética"],
                    rulesetVersion: "demo-1",
                    contentHash: "abc",
                    createdAt: "2026-11-11T12:00:00Z",
                  },
                },
              ],
        ),
      );
    }),
  );
  render(<App initialToken="staff-token" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Abrir laudo DEMO-02" }),
  );
  fireEvent.change(screen.getByLabelText("Classificação do hospital"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Desfecho"), {
    target: { value: "referred" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Registrar classificação final" }),
  );
  expect(await screen.findByText("Classificação registrada.")).toBeTruthy();
  expect(
    await screen.findByText("Nenhuma pré-triagem na fila desta unidade."),
  ).toBeTruthy();
});
