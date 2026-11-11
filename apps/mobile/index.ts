import { registerRootComponent } from "expo";
import { Platform } from "react-native";
import App from "./App";
import "./global.css";
if (Platform.OS === "web") document.documentElement.lang = "pt-BR";
registerRootComponent(App);
