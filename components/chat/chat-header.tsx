import { ThemedText } from "@/components/themed-text";
import { useThemeColor } from "@/hooks/use-theme-color";
import type { ExportFormat } from "@/lib/conversationExporter";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const HEADER_HEIGHT = 52;

type ChatHeaderProps = {
  onExport: (format: ExportFormat) => void;
};

export function ChatHeader({ onExport }: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const borderColor = useThemeColor({}, "border");
  const textColor = useThemeColor({}, "text");
  const surfaceColor = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");

  const handleExport = (format: ExportFormat) => {
    setMenuOpen(false);
    onExport(format);
  };

  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top, borderBottomColor: borderColor, backgroundColor },
      ]}
    >
      <ThemedText style={styles.title}>Relay AI</ThemedText>

      <Pressable
        onPress={() => setMenuOpen(true)}
        hitSlop={12}
        style={styles.menuButton}
        accessibilityLabel="More options"
        accessibilityRole="button"
      >
        <MaterialIcons name="more-vert" size={22} color={textColor} />
      </Pressable>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setMenuOpen(false)}>
          <View
            style={[
              styles.menu,
              { top: insets.top + HEADER_HEIGHT, backgroundColor: surfaceColor, borderColor },
            ]}
          >
            <Pressable style={styles.menuItem} onPress={() => handleExport("markdown")}>
              <MaterialIcons name="description" size={18} color={textColor} />
              <ThemedText>Export as Markdown</ThemedText>
            </Pressable>
            <View style={[styles.menuDivider, { backgroundColor: borderColor }]} />
            <Pressable style={styles.menuItem} onPress={() => handleExport("json")}>
              <MaterialIcons name="code" size={18} color={textColor} />
              <ThemedText>Export as JSON</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  menuButton: {
    padding: 4,
  },
  overlay: {
    flex: 1,
  },
  menu: {
    position: "absolute",
    right: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    minWidth: 190,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
  },
});
