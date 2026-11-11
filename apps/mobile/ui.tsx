import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

export const colors = {
  wine: "#5A1E16",
  green: "#45B08C",
  ink: "#2A2524",
  muted: "#5C6660",
  danger: "#B3263A",
  paper: "#F7F9F7",
  page: "#E6ECE8",
  warning: "#FFF8DC",
};
export function Copy({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}
export function Title({
  children,
  question = false,
}: {
  children: ReactNode;
  question?: boolean;
}) {
  return (
    <Text
      accessibilityRole="header"
      style={[styles.title, question && styles.question]}
    >
      {children}
    </Text>
  );
}
export function Button({
  children,
  onPress,
  primary = false,
  disabled = false,
  danger = false,
}: {
  children: ReactNode;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primary,
        danger && styles.dangerBorder,
        (disabled || pressed) && { opacity: 0.6 },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          primary && { color: colors.ink },
          danger && { color: colors.danger },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}
export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  column: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: colors.paper,
  },
  scroll: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  body: {
    fontFamily: "Figtree_400Regular",
    color: colors.ink,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 8,
  },
  muted: { color: colors.muted },
  title: {
    fontFamily: "BodoniModa_700Bold",
    color: colors.wine,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: 1.12,
    marginBottom: 16,
  },
  question: {
    fontFamily: "BodoniModa_500Medium",
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0,
  },
  button: {
    borderWidth: 2,
    borderColor: colors.wine,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  primary: { backgroundColor: colors.green },
  dangerBorder: { borderColor: colors.danger },
  buttonText: {
    fontFamily: "Figtree_600SemiBold",
    fontSize: 18,
    lineHeight: 26,
    color: colors.wine,
    textAlign: "center",
  },
  field: { gap: 8, marginBottom: 12 },
  label: {
    color: colors.wine,
    fontFamily: "Figtree_600SemiBold",
    fontSize: 16,
    lineHeight: 24,
  },
  input: {
    minHeight: 48,
    borderWidth: 2,
    borderColor: colors.wine,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontFamily: "Figtree_400Regular",
    fontSize: 16,
    color: colors.ink,
  },
  card: {
    borderWidth: 2,
    borderColor: colors.wine,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    padding: 12,
    marginBottom: 12,
  },
  warning: {
    backgroundColor: colors.warning,
    borderWidth: 2,
    borderColor: "#E8B923",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  error: {
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: "#FFFFFF",
    padding: 12,
  },
  emergency: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 2,
    borderColor: colors.wine,
    backgroundColor: colors.paper,
  },
  code: {
    fontFamily: "BodoniModa_700Bold",
    fontSize: 40,
    letterSpacing: 4.8,
    color: colors.wine,
  },
  switchRow: {
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#CFDAD3",
  },
  progress: { height: 8, backgroundColor: "#CFDAD3", marginBottom: 16 },
});
