import { MessageBubble } from "@/components/chat/message-bubble";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import type { Message } from "@/lib/chat";
import { useChatStore } from "@/store/chatStore";
import { FlashList } from "@shopify/flash-list";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");
  const messages = useChatStore((state) => state.messages);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const error = useChatStore((state) => state.error);
  const init = useChatStore((state) => state.init);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const loadOlderMessages = useChatStore((state) => state.loadOlderMessages);
  const isLoadingOlder = useChatStore((state) => state.isLoadingOlder);

  const borderColor = useThemeColor({}, "border");
  const inputBackground = useThemeColor({}, "surface");
  const tint = useThemeColor({}, "tint");
  const textColor = useThemeColor({}, "text");
  const onTint = useThemeColor({}, "onTint");
  const placeholderColor = useThemeColor({}, "placeholder");
  const errorColor = useThemeColor({}, "error");

  const renderItem = useCallback(({ item }: { item: Message }) => <MessageBubble message={item} />, []);

  const historyLoader = isLoadingOlder ? (
    <View style={styles.historyLoader}>
      <ActivityIndicator size="small" color={textColor} />
    </View>
  ) : null;

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
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          // Opens the list scrolled to the latest message. Deliberately NOT
          // maintainVisibleContentPosition.startRenderingFromBottom: that prop
          // also keeps a live marginTop on the whole rendered block, recomputed
          // from total content height on every render, to cosmetically pin a
          // short conversation to the bottom of the screen. Since it depends on
          // total height, it recalculates on every streamed token and reflows
          // (shifts) every already-rendered message — including ones the user
          // has scrolled up to read — not just the growing one. initialScrollIndex
          // gets the same "open at the bottom" result as a one-shot scroll with
          // no ongoing layout side effect.
          initialScrollIndex={messages.length > 0 ? messages.length - 1 : undefined}
          // FlashList v2 auto-measures items and has dropped estimatedItemSize;
          // this is the prop it added specifically for chat UIs — it keeps the
          // list pinned to the bottom as new tokens arrive, but only while the
          // user is already near the bottom, so scrolling up to read earlier
          // messages stops the auto-follow immediately.
          // animateAutoScrollToBottom is off on purpose: the message content
          // (and thus list height) changes every UI_FLUSH_MS tick, so an
          // *animated* scrollToEnd gets re-issued mid-animation on every tick
          // and visibly stutters. An instant snap every tick reads as smooth
          // continuous tracking instead of a fight between animations.
          maintainVisibleContentPosition={{
            autoscrollToBottomThreshold: 0.2,
            animateAutoScrollToBottom: false,
          }}
          // Fires once the oldest loaded message scrolls fully into view near
          // the top; loadOlderMessages() prepends the next page (guarded
          // against overlapping calls and an exhausted history in the store).
          onStartReached={loadOlderMessages}
          onStartReachedThreshold={0.2}
          ListHeaderComponent={historyLoader}
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
  historyLoader: {
    paddingVertical: 12,
    alignItems: "center",
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
