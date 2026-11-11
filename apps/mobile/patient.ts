import type { Api, Session } from "@brvital/contracts";

export interface PrivateStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export type SessionScreen = "questionnaire" | "emergency" | "report";
export function sessionScreen(session: Session): SessionScreen {
  if (session.status === "emergency" || session.outcome === "EMERGENCY")
    return "emergency";
  return session.status === "completed" ? "report" : "questionnaire";
}

export function createPatient(api: Api, storage: PrivateStorage) {
  return {
    async resume() {
      const id = await storage.get("sessionId");
      if (!id) return null;
      const session = await api.session(id);
      return { screen: sessionScreen(session), session };
    },
    async start() {
      const session = await api.startSession();
      await storage.set("sessionId", session.sessionId);
      return { screen: sessionScreen(session), session };
    },
  };
}

export function createTokenSession(storage: PrivateStorage) {
  let token: string | null = null;
  return {
    token: () => token,
    async restore() {
      token = await storage.get("accessToken");
      return token;
    },
    async signIn(value: string) {
      await storage.set("accessToken", value);
      token = value;
    },
    async signOut() {
      token = null;
      await Promise.all([
        storage.remove("accessToken"),
        storage.remove("sessionId"),
      ]);
    },
  };
}
