import { expect, test, vi } from "vitest";
import { createPatient, createTokenSession } from "./patient";
import type { Api, Session } from "@brvital/contracts";

test("retoma sessão salva pela API e mantém alerta de emergência como único destino", async () => {
  const emergency: Session = {
    sessionId: "session-1",
    answers: { alarm: "yes" },
    status: "emergency",
    nextQuestion: null,
    progress: { answered: 1, total: 5 },
    outcome: "EMERGENCY",
  };
  const storage = {
    get: vi.fn(async () => "session-1"),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const api = { session: vi.fn(async () => emergency) } as unknown as Api;
  const patient = createPatient(api, storage);
  const state = await patient.resume();
  expect(state).toEqual({ screen: "emergency", session: emergency });
  expect(storage.set).not.toHaveBeenCalled();
});

test("não usa credencial após sair e remove o identificador de retomada", async () => {
  const values = new Map<string, string>([
    ["accessToken", "saved-token"],
    ["sessionId", "session-1"],
  ]);
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  const auth = createTokenSession(storage);
  await auth.restore();
  expect(auth.token()).toBe("saved-token");
  await auth.signOut();
  expect(auth.token()).toBeNull();
  const reopened = createTokenSession(storage);
  expect(await reopened.restore()).toBeNull();
  expect(await storage.get("sessionId")).toBeNull();
});

test("queda de conexão ao retomar não apaga o identificador nem inventa conclusão", async () => {
  const storage = {
    get: async () => "session-1",
    set: vi.fn(),
    remove: vi.fn(),
  };
  const api = {
    session: async () => {
      throw new Error("Sem conexão");
    },
  } as unknown as Api;
  await expect(createPatient(api, storage).resume()).rejects.toThrow(
    "Sem conexão",
  );
  expect(storage.remove).not.toHaveBeenCalled();
});
