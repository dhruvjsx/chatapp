import { ThemedText } from "@/components/themed-text";
import { useThemeColor } from "@/hooks/use-theme-color";
import type { Message } from "@/lib/chat";
import { useOfflineQueueStore } from "@/store/offlineQueueStore";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const tint = useThemeColor({}, "tint");
  const userText = useThemeColor({}, "onTint");
  const assistantBackground = useThemeColor({}, "surface");
  const assistantText = useThemeColor({}, "text");
  const errorColor = useThemeColor({}, "error");

  // Pending/failed is derived entirely from offline-queue membership, not a
  // status field on the message itself: the message is written to
  // chatStore.messages once, at compose time, and never touched again by the
  // queue - what changes is only whether its id is still sitting in
  // useOfflineQueueStore's queue. Once flush() removes it, this selector
  // returns undefined on the next render and the badge disappears on its
  // own, with no separate "mark as sent" call anywhere.
  const queuedStatus = useOfflineQueueStore((state) => state.queue.find((q) => q.id === message.id)?.status);
  const isPending = isUser && queuedStatus === "pending";
  const isFailedSend = isUser && queuedStatus === "failed";

  const isEmptyStreaming = message.status === "streaming" && message.content.length === 0;
  const isFailedAssistantReply = !isUser && message.status === "error" && message.content.length === 0;

  let displayText = message.content;
  if (isFailedAssistantReply) displayText = "⚠ Failed to respond";

  const bubble = (
    <View
      style={[
        styles.bubble,
        isUser ? { backgroundColor: tint } : { backgroundColor: assistantBackground },
        isPending && styles.pendingBubble,
      ]}
    >
      {isEmptyStreaming ? (
        <ActivityIndicator size="small" color={assistantText} />
      ) : (
        <ThemedText style={isUser ? { color: userText } : { color: assistantText }}>{displayText}</ThemedText>
      )}
      {isPending ? (
        <View style={styles.statusRow}>
          <MaterialIcons name="schedule" size={12} color={userText} />
          <ThemedText style={[styles.statusText, { color: userText }]}>Waiting to send…</ThemedText>
        </View>
      ) : null}
      {isFailedSend ? (
        <View style={styles.statusRow}>
          <MaterialIcons name="error-outline" size={12} color={errorColor} />
          <ThemedText style={[styles.statusText, { color: errorColor }]}>Not sent - will retry</ThemedText>
        </View>
      ) : null}
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
  pendingBubble: {
    opacity: 0.55,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  statusText: {
    fontSize: 11,
  },
});
