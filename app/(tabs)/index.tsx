import { MessageBubble } from "@/components/chat/message-bubble";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import type { Message } from "@/lib/chat";
import { useChatStore } from "@/store/chatStore";
import { FlashList } from "@shopify/flash-list";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");
  const messages = useChatStore((state) => state.messages);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const error = useChatStore((state) => state.error);
  const init = useChatStore((state) => state.init);
  const sendMessage = useChatStore((state) => state.sendMessage);

  const borderColor = useThemeColor({}, "border");
  const inputBackground = useThemeColor({}, "surface");
  const tint = useThemeColor({}, "tint");
  const textColor = useThemeColor({}, "text");
  const onTint = useThemeColor({}, "onTint");
  const placeholderColor = useThemeColor({}, "placeholder");
  const errorColor = useThemeColor({}, "error");

  useEffect(() => {
    init();
  }, [init]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput("");
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.list}>
        <FlashList<Message>
          data={messages}
          keyExtractor={(message) => message.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.listContent}
          // FlashList v2 auto-measures items and has dropped estimatedItemSize;
          // this is the prop it added specifically for chat UIs — it keeps the
          // list pinned to the bottom as new tokens arrive, but only while the
          // user is already near the bottom, so scrolling up to read earlier
          // messages stops the auto-follow immediately.
          maintainVisibleContentPosition={{
            autoscrollToBottomThreshold: 0.2,
            startRenderingFromBottom: true,
          }}
          ListEmptyComponent={
            <ThemedText style={styles.emptyText}>Say something to start the conversation.</ThemedText>
          }
        />
      </View>

      {error ? (
        <ThemedText style={[styles.errorText, { color: errorColor }]} numberOfLines={2}>
          {error}
        </ThemedText>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.bottom}
      >
        <View style={[styles.inputRow, { borderTopColor: borderColor, paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={[styles.input, { backgroundColor: inputBackground, color: textColor }]}
            value={input}
            onChangeText={setInput}
            placeholder="Message Relay…"
            placeholderTextColor={placeholderColor}
            multiline
            editable={!isStreaming}
          />
          <Pressable
            onPress={handleSend}
            disabled={!input.trim() || isStreaming}
            style={[styles.sendButton, { backgroundColor: tint, opacity: !input.trim() || isStreaming ? 0.5 : 1 }]}
          >
            <ThemedText style={[styles.sendButtonText, { color: onTint }]}>
              {isStreaming ? "…" : "Send"}
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 12,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 40,
    opacity: 0.6,
  },
  errorText: {
    textAlign: "center",
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 16,
  },
  sendButton: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonText: {
    fontWeight: "600",
  },
});
