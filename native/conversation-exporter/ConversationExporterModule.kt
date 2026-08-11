package __PACKAGE_NAME__

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.chatapp.specs.NativeConversationExporterSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// Baked in at prebuild time by plugins/withConversationExporter.js, which
// substitutes these from the same EXPO_PUBLIC_SUPABASE_* env vars
// lib/supabase.ts reads on the JS side (see that file). These are Supabase's
// *anon* key, not a secret — it's meant to ship inside client binaries and is
// only as safe as the table's RLS policies (see ARCHITECTURE.md's "no auth"
// gap), same trust model as it already has embedded in the JS bundle today.
private const val SUPABASE_URL = "__SUPABASE_URL__"
private const val SUPABASE_ANON_KEY = "__SUPABASE_ANON_KEY__"

// Rows per Supabase REST page. This is what keeps a 1,000-message export from
// ever holding the full conversation in memory: fetch one page, write it,
// discard it, fetch the next. Memory use is O(PAGE_SIZE), not O(conversation
// length), regardless of how long the conversation grows.
private const val PAGE_SIZE = 200

private class ExportException(val code: String, override val message: String) : Exception(message)

/**
 * Kotlin TurboModule backing `exportConversation`. Given just a
 * conversationId (see specs/NativeConversationExporter.ts — the JS side
 * never hands this module a message array), it fetches that conversation's
 * messages directly from Supabase's REST API and streams them straight to a
 * markdown file, formatting and writing on a background thread throughout.
 *
 * Deliberately not given the messages by JS: for 1,000 messages, that would
 * mean JS holds the whole conversation as one in-memory array *and*
 * serializes it into one giant string crossing the bridge — exactly the
 * "single big in-memory string" problem this module exists to avoid, just
 * moved to the JS side instead of solved.
 *
 * Markdown-only: a JSON export mode existed here too, but had a bug that
 * wasn't worth chasing under this take-home's time budget, so it was cut
 * rather than shipped half-working — see ARCHITECTURE.md.
 */
class ConversationExporterModule(reactContext: ReactApplicationContext) :
  NativeConversationExporterSpec(reactContext) {

  // A dedicated single-thread executor, not GlobalScope/AsyncTask: exports
  // never overlap (there's exactly one export button, one export at a time
  // makes sense), and shutting it down in invalidate() means a torn-down
  // module (e.g. a dev reload) can't leak a running background thread.
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()

  override fun getName(): String = NAME

  override fun invalidate() {
    super.invalidate()
    executor.shutdown()
  }

  override fun exportConversation(conversationId: String, promise: Promise) {
    executor.execute {
      val startedAt = System.currentTimeMillis()
      val resolver = reactApplicationContext.contentResolver
      var uri: android.net.Uri? = null

      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
          // MediaStore's scoped Downloads collection (MediaStore.Downloads)
          // only exists from API 29 onward. Older versions would need a
          // separate legacy WRITE_EXTERNAL_STORAGE + raw File path — a real
          // second code path this take-home's scope doesn't cover, so we
          // fail loudly here instead of silently writing somewhere the user
          // can't find.
          throw ExportException("E_WRITE_FAILED", "Export needs Android 10 (API 29) or newer.")
        }

        val fileName = "relay-${conversationId.take(8)}-$startedAt.md"
        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
          put(MediaStore.MediaColumns.MIME_TYPE, "text/markdown")
          put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }

        uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw ExportException("E_WRITE_FAILED", "MediaStore refused to create the export file.")

        var messageCount = 0
        resolver.openOutputStream(uri)?.use { stream ->
          BufferedWriter(OutputStreamWriter(stream, StandardCharsets.UTF_8)).use { writer ->
            messageCount = writeConversation(writer, conversationId)
          }
        } ?: throw ExportException("E_WRITE_FAILED", "Could not open an output stream for the export file.")

        if (messageCount == 0) {
          throw ExportException("E_CONVERSATION_NOT_FOUND", "Conversation $conversationId has no messages to export.")
        }

        values.clear()
        values.put(MediaStore.MediaColumns.IS_PENDING, 0)
        val updatedRows = resolver.update(uri, values, null, null)
        if (updatedRows != 1) {
          // A pending row that never gets cleared is invisible everywhere —
          // Files apps, search, even other apps' MediaStore queries — not
          // just absent from Downloads. The write itself succeeded (we can
          // still read it back below, since the owning app always sees its
          // own pending files), but from the user's perspective a file
          // that's fully written yet permanently hidden is the same as one
          // that was never saved, so this must fail loudly rather than
          // resolve with a URI nothing else can find.
          throw ExportException(
            "E_WRITE_FAILED",
            "Export file was written but MediaStore wouldn't publish it (update() touched $updatedRows rows)."
          )
        }

        val sizeBytes = resolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: 0L

        val result: WritableMap = Arguments.createMap().apply {
          putString("uri", uri.toString())
          putDouble("sizeBytes", sizeBytes.toDouble())
          putDouble("durationMs", (System.currentTimeMillis() - startedAt).toDouble())
        }
        promise.resolve(result)
      } catch (e: ExportException) {
        // Half-written or empty file left behind (e.g. the write failed
        // partway through, or the conversation turned out to be empty) —
        // clean it up rather than leaving a broken file sitting in Downloads.
        uri?.let { resolver.delete(it, null, null) }
        promise.reject(e.code, e.message, e)
      } catch (e: Exception) {
        uri?.let { resolver.delete(it, null, null) }
        promise.reject("E_WRITE_FAILED", e.message ?: "Export failed.", e)
      }
    }
  }

  /**
   * Pages through Supabase's REST API and writes each page to [writer] as it
   * arrives — never assembling the full export in memory. Returns the total
   * message count, which the caller uses to tell "empty conversation" apart
   * from "wrote something."
   */
  private fun writeConversation(writer: BufferedWriter, conversationId: String): Int {
    writer.write("# Relay conversation export\n\n")
    writer.write("Conversation: $conversationId  \n")
    writer.write("Exported: ${isoNow()}\n\n---\n")

    var offset = 0
    var totalWritten = 0

    while (true) {
      val page = fetchMessagePage(conversationId, offset, PAGE_SIZE)
      if (page.length() == 0) break

      for (i in 0 until page.length()) {
        writeMessage(writer, page.getJSONObject(i))
        totalWritten++
      }

      offset += page.length()
      if (page.length() < PAGE_SIZE) break
    }

    writer.flush()
    return totalWritten
  }

  private fun writeMessage(writer: BufferedWriter, message: JSONObject) {
    val role = message.optString("role", "unknown")
    val heading = if (role == "user") "You" else "Assistant"
    writer.write("\n### $heading — ${message.optString("created_at", "")}\n\n")
    writer.write(message.optString("content", ""))
    writer.write("\n")
  }

  /** One page of `messages` rows for `conversationId`, oldest first. */
  private fun fetchMessagePage(conversationId: String, offset: Int, limit: Int): JSONArray {
    val encodedId = URLEncoder.encode(conversationId, "UTF-8")
    val url = URL(
      "$SUPABASE_URL/rest/v1/messages" +
        "?conversation_id=eq.$encodedId" +
        "&select=role,content,created_at" +
        "&order=created_at.asc" +
        "&offset=$offset&limit=$limit"
    )

    val connection = url.openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 15_000
      connection.readTimeout = 15_000
      connection.setRequestProperty("apikey", SUPABASE_ANON_KEY)
      connection.setRequestProperty("Authorization", "Bearer $SUPABASE_ANON_KEY")

      if (connection.responseCode != HttpURLConnection.HTTP_OK) {
        val body = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
        throw ExportException(
          "E_FETCH_FAILED",
          "Supabase returned ${connection.responseCode} fetching messages: $body"
        )
      }

      val body = connection.inputStream.bufferedReader().use { it.readText() }
      return JSONArray(body)
    } catch (e: ExportException) {
      throw e
    } catch (e: Exception) {
      throw ExportException("E_FETCH_FAILED", e.message ?: "Failed to fetch messages from Supabase.")
    } finally {
      connection.disconnect()
    }
  }

  private fun isoNow(): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(Date())
  }

  companion object {
    const val NAME = "ConversationExporter"
  }
}
