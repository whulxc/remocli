package com.remoteconnect.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlin.math.abs

class SessionNotifier(private val context: Context) {
  private val notificationManager = NotificationManagerCompat.from(context)
  private val mainHandler = Handler(Looper.getMainLooper())

  init {
    ensureChannels()
  }

  fun show(kind: String, title: String, body: String) {
    show(kind, title, body, true, true, true)
  }

  fun show(kind: String, title: String, body: String, showNotification: Boolean, playSound: Boolean, shouldVibrate: Boolean) {
    Log.d(TAG, "show kind=$kind notify=$showNotification sound=$playSound vibrate=$shouldVibrate title=$title")
    val channelId = when (kind) {
      "needs_input" -> CHANNEL_ATTENTION
      "error" -> CHANNEL_ERROR
      "completed" -> CHANNEL_COMPLETED
      else -> CHANNEL_ARTIFACT
    }

    if (showNotification) {
      val notification = NotificationCompat.Builder(context, channelId)
        .setSmallIcon(android.R.drawable.stat_notify_more)
        .setContentTitle(title)
        .setContentText(body)
        .setCategory(
          if (kind == "needs_input" || kind == "error") NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS,
        )
        .setPriority(
          if (kind == "needs_input" || kind == "error") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT,
        )
        .setDefaults(
          (if (playSound) NotificationCompat.DEFAULT_SOUND else 0)
            or (if (shouldVibrate) NotificationCompat.DEFAULT_VIBRATE else 0),
        )
        .setAutoCancel(true)
        .setSilent(false)
        .build()

      notificationManager.notify(abs("$kind:$title:$body".hashCode()), notification)
    }

    if (playSound) {
      mainHandler.post {
        beep(kind)
      }
    }

    if (shouldVibrate) {
      mainHandler.post {
        vibrate(kind)
      }
    }
  }

  private fun vibrate(kind: String) {
    val effect = if (kind == "needs_input") {
      VibrationEffect.createWaveform(longArrayOf(0, 220, 120, 220), -1)
    } else if (kind == "error") {
      VibrationEffect.createWaveform(longArrayOf(0, 240, 100, 240, 100, 300), -1)
    } else if (kind == "completed") {
      VibrationEffect.createWaveform(longArrayOf(0, 140, 90, 140), -1)
    } else {
      VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE)
    }

    val service = resolveVibrator() ?: return
    if (!service.hasVibrator()) {
      Log.d(TAG, "vibrate skipped: no vibrator")
      return
    }
    Log.d(TAG, "vibrate kind=$kind")
    service.cancel()
    service.vibrate(effect)
  }

  private fun beep(kind: String) {
    Log.d(TAG, "beep kind=$kind")
    val (streamType, toneType, pulseDurationMs, pulseOffsets) = when (kind) {
      "completed" -> TonePattern(
        streamType = AudioManager.STREAM_NOTIFICATION,
        toneType = ToneGenerator.TONE_PROP_ACK,
        pulseDurationMs = 220,
        pulseOffsets = longArrayOf(0),
      )
      "error" -> TonePattern(
        streamType = AudioManager.STREAM_ALARM,
        toneType = ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD,
        pulseDurationMs = 260,
        pulseOffsets = longArrayOf(0, 360, 720),
      )
      else -> TonePattern(
        streamType = AudioManager.STREAM_ALARM,
        toneType = ToneGenerator.TONE_PROP_BEEP,
        pulseDurationMs = 240,
        pulseOffsets = longArrayOf(0, 340),
      )
    }

    runCatching {
      val toneGenerator = ToneGenerator(streamType, 100)
      for (offset in pulseOffsets) {
        if (offset == 0L) {
          toneGenerator.startTone(toneType, pulseDurationMs)
        } else {
          mainHandler.postDelayed(
            { toneGenerator.startTone(toneType, pulseDurationMs) },
            offset,
          )
        }
      }
      val releaseAfter = (pulseOffsets.maxOrNull() ?: 0L) + pulseDurationMs + 180L
      mainHandler.postDelayed(
        {
          runCatching { toneGenerator.release() }
        },
        releaseAfter,
      )
    }.onFailure {
      Log.w(TAG, "tone playback failed", it)
    }
  }

  private fun resolveVibrator(): Vibrator? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    }
    return context.getSystemService(Vibrator::class.java)
  }

  private fun ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val systemManager = context.getSystemService(NotificationManager::class.java)
    val notificationAudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val defaultNotificationSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    val attention = NotificationChannel(
      CHANNEL_ATTENTION,
      "Codex attention",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Codex sessions waiting for input or confirmation."
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 140, 80, 140)
      setSound(defaultNotificationSound, notificationAudioAttributes)
    }

    val error = NotificationChannel(
      CHANNEL_ERROR,
      "Codex errors",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Codex sessions that entered an error state."
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 180, 70, 180, 70, 220)
      setSound(defaultNotificationSound, notificationAudioAttributes)
    }

    val artifact = NotificationChannel(
      CHANNEL_ARTIFACT,
      "Codex artifacts",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "New images or artifacts from active sessions."
      enableVibration(true)
    }

    val completed = NotificationChannel(
      CHANNEL_COMPLETED,
      "Codex completed",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "Sessions that finished running and are ready for your next command."
      enableVibration(false)
      setSound(defaultNotificationSound, notificationAudioAttributes)
    }

    systemManager.createNotificationChannels(listOf(attention, error, artifact, completed))
  }

  companion object {
    private const val TAG = "SessionNotifier"
    private const val CHANNEL_ATTENTION = "codex_attention"
    private const val CHANNEL_ERROR = "codex_error"
    private const val CHANNEL_ARTIFACT = "codex_artifact"
    private const val CHANNEL_COMPLETED = "codex_completed"
  }

  private data class TonePattern(
    val streamType: Int,
    val toneType: Int,
    val pulseDurationMs: Int,
    val pulseOffsets: LongArray,
  )
}
