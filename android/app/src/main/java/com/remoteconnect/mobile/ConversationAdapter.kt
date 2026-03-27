package com.remoteconnect.mobile

import android.graphics.Color
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView

class ConversationAdapter : RecyclerView.Adapter<ConversationAdapter.MessageViewHolder>() {
  private val items = mutableListOf<ConversationItem>()

  fun submitItems(next: List<ConversationItem>) {
    items.clear()
    items.addAll(next)
    notifyDataSetChanged()
  }

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
    val view = LayoutInflater.from(parent.context).inflate(R.layout.item_message, parent, false)
    return MessageViewHolder(view)
  }

  override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
    val item = items[position]
    val isUser = item.role == "user"
    holder.root.gravity = if (isUser) Gravity.END else Gravity.START
    holder.role.text = holder.itemView.context.getString(
      if (isUser) R.string.message_you else R.string.message_computer,
    )
    holder.body.text = item.text
    holder.body.setBackgroundResource(if (isUser) R.drawable.bg_message_right else R.drawable.bg_message_left)
    holder.body.setTextColor(
      if (isUser) {
        Color.WHITE
      } else {
        ContextCompat.getColor(holder.itemView.context, R.color.text_primary)
      },
    )
  }

  override fun getItemCount(): Int = items.size

  class MessageViewHolder(view: View) : RecyclerView.ViewHolder(view) {
    val root: LinearLayout = view as LinearLayout
    val role: TextView = view.findViewById(R.id.message_role)
    val body: TextView = view.findViewById(R.id.message_body)
  }
}
