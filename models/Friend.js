// Friend.js - Friend relationship model for social connections
const mongoose = require('mongoose');

console.log('📌 [Friend Model] Initializing Friend schema...');

const friendSchema = new mongoose.Schema({
  // User who sent the friend request
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Sender is required'],
    index: true
  },

  // User who received the friend request  
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Receiver is required'],
    index: true
  },

  // Status of the friendship
  status: {
    type: String,
    enum: {
      values: ['pending', 'accepted', 'rejected', 'blocked'],
      message: 'Status must be one of: pending, accepted, rejected, blocked'
    },
    default: 'pending',
    required: true,
    index: true
  },

  // When the request was sent
  requestedAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  // When the request was responded to
  respondedAt: {
    type: Date,
    index: true
  },

  // Additional metadata
  metadata: {
    // How they found each other (search, suggestion, mutual friends)
    connectionType: {
      type: String,
      enum: ['search', 'suggestion', 'mutual', 'import', 'other'],
      default: 'search'
    },

    // Message with friend request (optional)
    message: {
      type: String,
      maxlength: [200, 'Friend request message cannot exceed 200 characters'],
      trim: true
    },

    // Mutual friends count at time of request
    mutualFriendsCount: {
      type: Number,
      default: 0,
      min: 0
    }
  }
}, {
  timestamps: true,
  versionKey: false
});

// 📌 Indexes for performance optimization
console.log('📌 [Friend Model] Setting up indexes...');

// Compound indexes for efficient queries
friendSchema.index({ sender: 1, receiver: 1 }, { 
  unique: true,
  name: 'unique_friendship'
});
friendSchema.index({ sender: 1, status: 1 }, { name: 'sender_status' });
friendSchema.index({ receiver: 1, status: 1 }, { name: 'receiver_status' });
friendSchema.index({ status: 1, requestedAt: -1 }, { name: 'status_date' });

// 📌 Pre-save validation
friendSchema.pre('save', function(next) {
  console.log(`📋 [Friend Model] Pre-save validation for ${this.sender} -> ${this.receiver}`);
  
  // Prevent self-friendship
  if (this.sender.toString() === this.receiver.toString()) {
    const error = new Error('Users cannot send friend requests to themselves');
    console.error('❌ [Friend Model] Self-friendship attempt blocked');
    return next(error);
  }

  // Set respondedAt when status changes from pending
  if (this.isModified('status') && this.status !== 'pending' && !this.respondedAt) {
    this.respondedAt = new Date();
    console.log(`📋 [Friend Model] Set respondedAt for status: ${this.status}`);
  }

  next();
});

// 📌 Static Methods

// Check if friendship exists between two users
friendSchema.statics.checkFriendship = async function(userId1, userId2) {
  console.log(`📋 [Friend Model] Checking friendship between ${userId1} and ${userId2}`);
  
  try {
    const friendship = await this.findOne({
      $or: [
        { sender: userId1, receiver: userId2 },
        { sender: userId2, receiver: userId1 }
      ]
    }).lean();

    console.log(`📋 [Friend Model] Friendship status: ${friendship?.status || 'none'}`);
    return friendship;
  } catch (error) {
    console.error('❌ [Friend Model] Error checking friendship:', error);
    throw error;
  }
};

// Get all friends of a user (accepted status)
friendSchema.statics.getFriends = async function(userId, options = {}) {
  console.log(`📋 [Friend Model] Getting friends for user: ${userId}`);
  
  const {
    populate = true,
    limit = 50,
    offset = 0,
    sortBy = 'respondedAt',
    sortOrder = -1
  } = options;

  try {
    const query = this.find({
      $or: [
        { sender: userId, status: 'accepted' },
        { receiver: userId, status: 'accepted' }
      ]
    })
    .sort({ [sortBy]: sortOrder })
    .skip(offset)
    .limit(limit);

    if (populate) {
      query.populate('sender', 'name username avatar email')
           .populate('receiver', 'name username avatar email');
    }

    const friendships = await query.lean();
    
    console.log(`✅ [Friend Model] Found ${friendships.length} friends for user: ${userId}`);
    return friendships;
  } catch (error) {
    console.error('❌ [Friend Model] Error getting friends:', error);
    throw error;
  }
};

// Get pending friend requests (received)
friendSchema.statics.getPendingRequests = async function(userId, options = {}) {
  console.log(`📋 [Friend Model] Getting pending requests for user: ${userId}`);
  
  const { populate = true, limit = 20 } = options;

  try {
    const query = this.find({
      receiver: userId,
      status: 'pending'
    })
    .sort({ requestedAt: -1 })
    .limit(limit);

    if (populate) {
      query.populate('sender', 'name username avatar email');
    }

    const requests = await query.lean();
    
    console.log(`✅ [Friend Model] Found ${requests.length} pending requests for user: ${userId}`);
    return requests;
  } catch (error) {
    console.error('❌ [Friend Model] Error getting pending requests:', error);
    throw error;
  }
};

// Get sent friend requests (sent but not responded)
friendSchema.statics.getSentRequests = async function(userId, options = {}) {
  console.log(`📋 [Friend Model] Getting sent requests for user: ${userId}`);
  
  const { populate = true, limit = 20 } = options;

  try {
    const query = this.find({
      sender: userId,
      status: 'pending'
    })
    .sort({ requestedAt: -1 })
    .limit(limit);

    if (populate) {
      query.populate('receiver', 'name username avatar email');
    }

    const requests = await query.lean();
    
    console.log(`✅ [Friend Model] Found ${requests.length} sent requests for user: ${userId}`);
    return requests;
  } catch (error) {
    console.error('❌ [Friend Model] Error getting sent requests:', error);
    throw error;
  }
};

// Count friends
friendSchema.statics.getFriendCount = async function(userId) {
  console.log(`📋 [Friend Model] Counting friends for user: ${userId}`);
  
  try {
    const count = await this.countDocuments({
      $or: [
        { sender: userId, status: 'accepted' },
        { receiver: userId, status: 'accepted' }
      ]
    });

    console.log(`✅ [Friend Model] Friend count for ${userId}: ${count}`);
    return count;
  } catch (error) {
    console.error('❌ [Friend Model] Error counting friends:', error);
    throw error;
  }
};

// Get mutual friends between two users
friendSchema.statics.getMutualFriends = async function(userId1, userId2, options = {}) {
  console.log(`📋 [Friend Model] Getting mutual friends between ${userId1} and ${userId2}`);
  
  const { limit = 10 } = options;

  try {
    // Get friends of user1
    const user1Friends = await this.getFriends(userId1, { populate: false });
    const user1FriendIds = user1Friends.map(f => 
      f.sender.toString() === userId1 ? f.receiver : f.sender
    );

    // Get friends of user2
    const user2Friends = await this.getFriends(userId2, { populate: false });
    const user2FriendIds = user2Friends.map(f => 
      f.sender.toString() === userId2 ? f.receiver : f.sender
    );

    // Find intersection
    const mutualFriendIds = user1FriendIds.filter(id => 
      user2FriendIds.includes(id.toString())
    ).slice(0, limit);

    console.log(`✅ [Friend Model] Found ${mutualFriendIds.length} mutual friends`);
    return mutualFriendIds;
  } catch (error) {
    console.error('❌ [Friend Model] Error getting mutual friends:', error);
    throw error;
  }
};

// 📌 Instance Methods

// Get the other user in friendship
friendSchema.methods.getOtherUser = function(currentUserId) {
  return this.sender.toString() === currentUserId.toString() 
    ? this.receiver 
    : this.sender;
};

// Check if user can respond to this request
friendSchema.methods.canRespond = function(userId) {
  return this.receiver.toString() === userId.toString() && this.status === 'pending';
};

// 📌 Virtual fields
friendSchema.virtual('isAccepted').get(function() {
  return this.status === 'accepted';
});

friendSchema.virtual('isPending').get(function() {
  return this.status === 'pending';
});

friendSchema.virtual('age').get(function() {
  return Date.now() - this.requestedAt.getTime();
});

// 📌 Transform output
friendSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj.id = obj._id;
  delete obj._id;
  return obj;
};

console.log('✅ [Friend Model] Friend schema created successfully');

const Friend = mongoose.model('Friend', friendSchema);

module.exports = Friend;