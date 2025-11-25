const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema(
  {
    // Array of participant IDs (for now only support 2-person conversations)
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    // Last message in the conversation for preview
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    // Timestamp of last activity
    lastActivity: {
      type: Date,
      default: Date.now,
    },
    // Conversation type: 'private' (1-on-1) or 'group' (future feature)
    type: {
      type: String,
      enum: ["private", "group"],
      default: "private",
    },
    // For group conversations (future feature)
    name: {
      type: String,
      default: null,
    },
    // Track if conversation is archived
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  { 
    timestamps: true,
    // Add logging for debugging
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Create compound index for efficient participant queries
ConversationSchema.index({ participants: 1, lastActivity: -1 });
ConversationSchema.index({ participants: 1, type: 1 });

// Virtual to check if conversation is active
ConversationSchema.virtual('isActive').get(function() {
  return !this.isArchived;
});

// Static method to find conversation between two users
ConversationSchema.statics.findBetweenUsers = function(userId1, userId2) {
  console.log(`[Conversation Model] Finding conversation between users: ${userId1} and ${userId2}`);
  
  return this.findOne({
    type: "private",
    participants: { $all: [userId1, userId2] }
  }).populate('participants', 'name username avatar')
    .populate('lastMessage', 'content type createdAt sender');
};

// Static method to find all conversations for a user
ConversationSchema.statics.findByUserId = function(userId) {
  console.log(`[Conversation Model] Finding conversations for user: ${userId}`);
  
  return this.find({
    participants: userId,
    isArchived: false
  })
  .populate('participants', 'name username avatar')
  .populate('lastMessage', 'content type createdAt sender')
  .sort({ lastActivity: -1 });
};

// Method to update last activity
ConversationSchema.methods.updateLastActivity = function() {
  console.log(`[Conversation Model] Updating last activity for conversation: ${this._id}`);
  
  this.lastActivity = new Date();
  return this.save();
};

module.exports = mongoose.model("Conversation", ConversationSchema);