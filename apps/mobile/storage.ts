import { Platform } from "react-native";
import type { PrivateStorage } from "./patient";

// Na web, a credencial é efêmera por aba e acessível a JavaScript; nunca usar localStorage.
export const privateStorage: PrivateStorage = {
  async get(key) {
    if (Platform.OS === "web") return sessionStorage.getItem(`brvital.${key}`);
    return (await import("expo-secure-store")).getItemAsync(`brvital.${key}`);
  },
  async set(key, value) {
    if (Platform.OS === "web") {
      sessionStorage.setItem(`brvital.${key}`, value);
      return;
    }
    await (
      await import("expo-secure-store")
    ).setItemAsync(`brvital.${key}`, value);
  },
  async remove(key) {
    if (Platform.OS === "web") {
      sessionStorage.removeItem(`brvital.${key}`);
      return;
    }
    await (await import("expo-secure-store")).deleteItemAsync(`brvital.${key}`);
  },
};
