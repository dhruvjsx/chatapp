import { MMKV } from "react-native-mmkv";

// Single shared MMKV instance for local-only device state. Synchronous
// key-value storage (no AsyncStorage round trip), which matters for
// store/offlineQueueStore.ts: the persisted send queue needs to be readable
// the instant the store module evaluates, before first render, not after an
// async hydration tick.
export const storage = new MMKV({ id: "relay-storage" });
