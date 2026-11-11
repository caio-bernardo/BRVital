import { useFonts } from "expo-font";
import { BodoniModa_500Medium } from "@expo-google-fonts/bodoni-moda/500Medium";
import { BodoniModa_700Bold } from "@expo-google-fonts/bodoni-moda/700Bold";
import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { StatusBar } from "expo-status-bar";
import { Linking, SafeAreaView, View } from "react-native";
import { PatientApp } from "./PatientApp";
import { Button, Copy, styles } from "./ui";

export default function App() {
  const [loaded, error] = useFonts({
    BodoniModa_500Medium,
    BodoniModa_700Bold,
    Figtree_400Regular,
    Figtree_600SemiBold,
  });
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      {loaded || error ? (
        <PatientApp />
      ) : (
        <View style={[styles.column, { padding: 20 }]}>
          <Copy>Carregando BR Vital…</Copy>
          <Button
            danger
            onPress={() => {
              void Linking.openURL("tel:192");
            }}
          >
            Emergência · ligar 192
          </Button>
        </View>
      )}
    </SafeAreaView>
  );
}
