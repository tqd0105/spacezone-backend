const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    // Reference to the conversation this message belongs to
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    // User who sent the message
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Message content
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000, // Limit message length
    },
    // Message type: 'text', 'image', 'file' (for future features)
    type: {
      type: String,
      enum: ["text", "image", "file"],
      default: "text",
    },
    // For non-text messages (future feature)
    fileUrl: {
      type: String,
      default: null,
    },
    fileName: {
      type: String,
      default: null,
    },
    fileSize: {
      type: Number,
      default: null,
    },
    // Message status
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    // Read status - array of user IDs who have read this message
    readBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { 
    timestamps: true,
    // Add logging for debugging
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Create compound indexes for efficient queries
MessageSchema.index({ conversation: 1, createdAt: -1 });
MessageSchema.index({ sender: 1, createdAt: -1 });
MessageSchema.index({ conversation: 1, isDeleted: 1, createdAt: -1 });

// Virtual to check if message is active
MessageSchema.virtual('isActive').get(function() {
  return !this.isDeleted;
});

// Static method to find messages in a conversation with pagination
MessageSchema.statics.findInConversation = function(conversationId, page = 1, limit = 50) {
  console.log(`[Message Model] Finding messages in conversation: ${conversationId}, page: ${page}, limit: ${limit}`);
  
  const skip = (page - 1) * limit;
  
  return this.find({
    conversation: conversationId,
    isDeleted: false
  })
  .populate('sender', 'name username avatar')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit);
};

// Method to mark message as read by user
MessageSchema.methods.markAsReadBy = function(userId) {
  console.log(`[Message Model] Marking message ${this._id} as read by user: ${userId}`);
  
  // Check if user has already read this message
  const existingRead = this.readBy.find(read => read.user.toString() === userId.toString());
  
  if (!existingRead) {
    this.readBy.push({
      user: userId,
      readAt: new Date()
    });
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Method to edit message content
MessageSchema.methods.editContent = function(newContent) {
  console.log(`[Message Model] Editing message ${this._id} with new content`);
  
  this.content = newContent;
  this.isEdited = true;
  this.editedAt = new Date();
  
  return this.save();
};

// Method to soft delete message
MessageSchema.methods.softDelete = function() {
  console.log(`[Message Model] Soft deleting message: ${this._id}`);
  
  this.isDeleted = true;
  this.deletedAt = new Date();
  
  return this.save();
};

// Static method to get unread count for user in conversation
MessageSchema.statics.getUnreadCount = function(conversationId, userId) {
  console.log(`[Message Model] Getting unread count for user ${userId} in conversation: ${conversationId}`);
  
  return this.countDocuments({
    conversation: conversationId,
    sender: { $ne: userId }, // Not sent by the user
    isDeleted: false,
    'readBy.user': { $ne: userId } // Not read by the user
  });
};

module.exports = mongoose.model("Message", MessageSchema);