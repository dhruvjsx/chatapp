import { ThemedText } from "@/components/themed-text";
import { useThemeColor } from "@/hooks/use-theme-color";
import type { Message } from "@/lib/chat";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const tint = useThemeColor({}, "tint");
  const userText = useThemeColor({}, "onTint");
  const assistantBackground = useThemeColor({}, "surface");
  const assistantText = useThemeColor({}, "text");

  const isEmptyStreaming = message.status === "streaming" && message.content.length === 0;
  const isFailedAssistantReply = !isUser && message.status === "error" && message.content.length === 0;

  let displayText = message.content;
  if (isFailedAssistantReply) displayText = "⚠ Failed to respond";

  const bubble = (
    <View style={[styles.bubble, isUser ? { backgroundColor: tint } : { backgroundColor: assistantBackground }]}>
      {isEmptyStreaming ? (
        <ActivityIndicator size="small" color={assistantText} />
      ) : (
        <ThemedText style={isUser ? { color: userText } : { color: assistantText }}>{displayText}</ThemedText>
      )}
    </View>
  );

  return <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>{bubble}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  rowAssistant: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
