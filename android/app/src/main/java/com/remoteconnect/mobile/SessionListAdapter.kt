package com.remoteconnect.mobile

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class SessionListAdapter(
  private val onSessionClick: (SessionSummary) -> Unit,
  private val onMoreClick: (View, SessionSummary) -> Unit,
) : RecyclerView.Adapter<SessionListAdapter.SessionViewHolder>() {
  private val sessions = mutableListOf<SessionSummary>()

  fun submitSessions(next: List<SessionSummary>) {
    sessions.clear()
    sessions.addAll(next)
    notifyDataSetChanged()
  }

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SessionViewHolder {
    val view = LayoutInflater.from(parent.context).inflate(R.layout.item_session, parent, false)
    return SessionViewHolder(view)
  }

  override fun onBindViewHolder(holder: SessionViewHolder, position: Int) {
    val session = sessions[position]
    holder.name.text = session.name
    holder.meta.text = listOf(session.kindLabel, session.workspace.ifBlank { session.currentPath })
      .filter { it.isNotBlank() }
      .joinToString(" · ")
    holder.preview.text = session.previewText.ifBlank {
      holder.itemView.context.getString(R.string.session_preview_fallback)
    }
    holder.greenDot.visibility = if (session.unreadCompleted) View.VISIBLE else View.GONE
    holder.itemView.setOnClickListener { onSessionClick(session) }
    holder.more.setOnClickListener { onMoreClick(it, session) }
  }

  override fun getItemCount(): Int = sessions.size

  class SessionViewHolder(view: View) : RecyclerView.ViewHolder(view) {
    val name: TextView = view.findViewById(R.id.session_name)
    val meta: TextView = view.findViewById(R.id.session_meta)
    val preview: TextView = view.findViewById(R.id.session_preview)
    val greenDot: View = view.findViewById(R.id.session_green_dot)
    val more: ImageButton = view.findViewById(R.id.session_more_button)
  }
}

