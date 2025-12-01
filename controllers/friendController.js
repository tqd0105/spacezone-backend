const Friend = require('../models/Friend');
const User = require('../models/User');
const mongoose = require('mongoose');

// LOG: Friend controller initialization
console.log('🎮 Initializing Friend Controller...');

/**
 * @desc    Send friend request to another user
 * @route   POST /api/friends/send-request
 * @access  Private
 */
const sendFriendRequest = async (req, res) => {
  try {
    console.log(`📤 Friend request attempt - From: ${req.user.id}, To: ${req.body.receiverId}`);
    
    const { receiverId } = req.body;
    const senderId = req.user.id;

    // Validation
    if (!receiverId) {
      console.log('❌ Missing receiverId');
      return res.status(400).json({ error: 'Receiver ID is required' });
    }

    if (receiverId === senderId.toString()) {
      console.log('❌ Self friend request attempt');
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }

    // Check if receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      console.log(`❌ Receiver not found: ${receiverId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Check existing relationship
    const existingRelation = await Friend.findOne({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId }
      ]
    });

    if (existingRelation) {
      const status = existingRelation.status;
      console.log(`❌ Existing relationship found: ${status}`);
      
      if (status === 'accepted') {
        return res.status(400).json({ error: 'You are already friends with this user' });
      } else if (status === 'pending') {
        return res.status(400).json({ error: 'Friend request already sent or received' });
      } else if (status === 'blocked') {
        return res.status(400).json({ error: 'Cannot send friend request to this user' });
      } else if (status === 'rejected') {
        // Allow new request after rejection - update existing record
        console.log('🔄 Updating rejected relationship to pending');
        existingRelation.status = 'pending';
        existingRelation.sender = senderId;
        existingRelation.receiver = receiverId;
        existingRelation.createdAt = new Date();
        
        await existingRelation.save();
        
        return res.status(201).json({
          success: true,
          message: 'Friend request sent successfully',
          data: {
            receiverId,
            receiverName: receiver.username,
            status: 'pending'
          }
        });
      }
    }

    // Create new friend request
    const friendRequest = new Friend({
      sender: senderId,
      receiver: receiverId,
      status: 'pending'
    });

    await friendRequest.save();

    res.status(201).json({
      success: true,
      message: 'Friend request sent successfully',
      data: {
        receiverId,
        receiverName: receiver.username,
        status: 'pending'
      }
    });

  } catch (error) {
    console.error('❌ Send friend request error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Accept friend request
 * @route   POST /api/friends/accept/:requestId
 * @access  Private
 */
const acceptFriendRequest = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    console.log(`✅ Accept friend request - User: ${req.user.id}, Request: ${req.params.requestId}`);
    
    const { requestId } = req.params;
    const userId = req.user.id;

    const result = await session.withTransaction(async () => {
      // Find the friend request
      const friendRequest = await Friend.findById(requestId).session(session);
      
      if (!friendRequest) {
        throw new Error('Friend request not found');
      }

      // Verify user is the receiver
      if (friendRequest.receiver.toString() !== userId.toString()) {
        console.log(`❌ Unauthorized accept attempt - Request receiver: ${friendRequest.receiver}, User: ${userId}`);
        throw new Error('You can only accept requests sent to you');
      }

      // Verify status is pending
      if (friendRequest.status !== 'pending') {
        throw new Error(`Cannot accept request with status: ${friendRequest.status}`);
      }

      // Update status to accepted
      friendRequest.status = 'accepted';
      friendRequest.acceptedAt = new Date();
      await friendRequest.save({ session });

      console.log(`✅ Friend request accepted: ${requestId}`);
      return friendRequest;
    });

    // Get sender info for response
    const friendRequest = await Friend.findById(requestId).populate('sender', 'username profilePicture');

    res.status(200).json({
      success: true,
      message: 'Friend request accepted successfully',
      data: {
        requestId,
        friend: {
          _id: friendRequest.sender._id,
          username: friendRequest.sender.username,
          profilePicture: friendRequest.sender.profilePicture
        },
        acceptedAt: friendRequest.acceptedAt
      }
    });

  } catch (error) {
    console.error('❌ Accept friend request error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reject friend request
 * @route   POST /api/friends/reject/:requestId
 * @access  Private
 */
const rejectFriendRequest = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    console.log(`❌ Reject friend request - User: ${req.user.id}, Request: ${req.params.requestId}`);
    
    const { requestId } = req.params;
    const userId = req.user.id;

    const result = await session.withTransaction(async () => {
      // Find the friend request
      const friendRequest = await Friend.findById(requestId).session(session);
      
      if (!friendRequest) {
        throw new Error('Friend request not found');
      }

      // Verify user is the receiver
      if (friendRequest.receiver.toString() !== userId.toString()) {
        throw new Error('You can only reject requests sent to you');
      }

      // Verify status is pending
      if (friendRequest.status !== 'pending') {
        throw new Error(`Cannot reject request with status: ${friendRequest.status}`);
      }

      // Update status to rejected
      friendRequest.status = 'rejected';
      await friendRequest.save({ session });

      console.log(`❌ Friend request rejected: ${requestId}`);
      return friendRequest;
    });

    res.status(200).json({
      success: true,
      message: 'Friend request rejected successfully',
      data: {
        requestId,
        status: 'rejected'
      }
    });

  } catch (error) {
    console.error('❌ Reject friend request error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Block a user
 * @route   POST /api/friends/block/:userId
 * @access  Private
 */
const blockUser = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    console.log(`🚫 Block user - Blocker: ${req.user.id}, Blocked: ${req.params.userId}`);
    
    const { userId } = req.params;
    const blockerId = req.user.id;

    if (userId === blockerId.toString()) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    // Check if user exists
    const userToBlock = await User.findById(userId);
    if (!userToBlock) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await session.withTransaction(async () => {
      // Remove any existing relationship
      await Friend.findOneAndDelete({
        $or: [
          { sender: blockerId, receiver: userId },
          { sender: userId, receiver: blockerId }
        ]
      }).session(session);

      // Create block relationship
      const blockRelation = new Friend({
        sender: blockerId,
        receiver: userId,
        status: 'blocked'
      });

      await blockRelation.save({ session });
      console.log(`🚫 User blocked successfully: ${userId}`);
      return blockRelation;
    });

    res.status(200).json({
      success: true,
      message: 'User blocked successfully',
      data: {
        blockedUserId: userId,
        blockedUsername: userToBlock.username,
        status: 'blocked'
      }
    });

  } catch (error) {
    console.error('❌ Block user error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Remove/unfriend a user
 * @route   DELETE /api/friends/remove/:friendId
 * @access  Private
 */
const removeFriend = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    console.log(`💔 Remove friend - User: ${req.user.id}, Friend: ${req.params.friendId}`);
    
    const { friendId } = req.params;
    const userId = req.user.id;

    const result = await session.withTransaction(async () => {
      // First, let's find any relationship between these users to debug
      const anyRelationship = await Friend.findOne({
        $or: [
          { sender: userId, receiver: friendId },
          { sender: friendId, receiver: userId }
        ]
      }).session(session);

      console.log('🔍 Found relationship:', anyRelationship);

      if (!anyRelationship) {
        throw new Error('No relationship found between these users');
      }

      // Check if it's an accepted friendship
      if (anyRelationship.status !== 'accepted') {
        throw new Error(`Cannot remove friendship with status: ${anyRelationship.status}`);
      }

      // Remove the friendship
      const friendship = await Friend.findOneAndDelete({
        $or: [
          { sender: userId, receiver: friendId, status: 'accepted' },
          { sender: friendId, receiver: userId, status: 'accepted' }
        ]
      }).session(session);

      if (!friendship) {
        throw new Error('Friendship not found or already removed');
      }

      console.log(`💔 Friendship removed successfully: ${friendship._id}`);
      return friendship;
    });

    res.status(200).json({
      success: true,
      message: 'Friend removed successfully',
      data: {
        removedFriendId: friendId
      }
    });

  } catch (error) {
    console.error('❌ Remove friend error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get user's friends list
 * @route   GET /api/friends/list
 * @access  Private
 */
const getFriends = async (req, res) => {
  try {
    console.log(`👥 Get friends list - User: ${req.user.id}`);
    
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    // Get friendships where user is sender or receiver and status is accepted
    const friendships = await Friend.find({
      $or: [
        { sender: userId, status: 'accepted' },
        { receiver: userId, status: 'accepted' }
      ]
    })
    .populate('sender', 'username name fullName avatar email')
    .populate('receiver', 'username name fullName avatar email')
    .sort({ acceptedAt: -1 })
    .skip(offset)
    .limit(limit)
    .lean();

    console.log(`📋 Found ${friendships.length} friendships for user ${userId}`);

    // Transform friendships to friend users (get the other user in each friendship)
    const friends = friendships.map(friendship => {
      const friend = friendship.sender._id.toString() === userId.toString() 
        ? friendship.receiver 
        : friendship.sender;
      
      // Add friendship metadata and ensure name field exists
      return {
        ...friend,
        name: friend.name || friend.fullName || friend.username, // Fallback cho name
        friendshipId: friendship._id,
        acceptedAt: friendship.acceptedAt,
        friendedAt: friendship.acceptedAt
      };
    });

    // Apply search filter if provided
    let filteredFriends = friends;
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filteredFriends = friends.filter(friend => 
        searchRegex.test(friend.username) || 
        searchRegex.test(friend.fullName)
      );
    }

    // Get total count for pagination
    const totalFriends = await Friend.countDocuments({
      $or: [
        { sender: userId, status: 'accepted' },
        { receiver: userId, status: 'accepted' }
      ]
    });

    console.log(`👥 Retrieved ${filteredFriends.length} friends (page ${page}) out of ${totalFriends} total`);
    console.log('📋 Sample friend data:', filteredFriends[0]);

    res.status(200).json({
      success: true,
      data: {
        friends: filteredFriends,
        pagination: {
          page,
          limit,
          total: totalFriends,
          totalPages: Math.ceil(totalFriends / limit)
        }
      }
    });

  } catch (error) {
    console.error('❌ Get friends error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Get friend requests (received and sent)
 * @route   GET /api/friends/requests
 * @access  Private
 */
const getFriendRequests = async (req, res) => {
  try {
    console.log(`📨 Get friend requests - User: ${req.user.id}`);
    
    const userId = req.user.id;
    const type = req.query.type || 'received'; // received, sent, or both
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    let requests = [];

    if (type === 'received' || type === 'both') {
      const receivedRequests = await Friend.getPendingRequests(userId, page, limit);
      requests = [...requests, ...receivedRequests.map(req => ({ ...req, type: 'received' }))];
    }

    if (type === 'sent' || type === 'both') {
      const sentRequests = await Friend.getSentRequests(userId, page, limit);
      requests = [...requests, ...sentRequests.map(req => ({ ...req, type: 'sent' }))];
    }

    console.log(`📨 Retrieved ${requests.length} friend requests (${type})`);

    res.status(200).json({
      success: true,
      data: {
        requests,
        pagination: {
          page,
          limit,
          type
        }
      }
    });

  } catch (error) {
    console.error('❌ Get friend requests error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Get friend suggestions based on mutual connections
 * @route   GET /api/friends/suggestions
 * @access  Private
 */
const getFriendSuggestions = async (req, res) => {
  try {
    console.log(`🎯 Get friend suggestions - User: ${req.user.id}`);
    
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;

    // Get user's friends to find mutual connections
    const userFriends = await Friend.getFriends(userId);
    const friendIds = userFriends.map(friend => friend._id);

    // Find mutual friends suggestions
    const suggestions = await Friend.getMutualFriends(userId, friendIds, limit);

    console.log(`🎯 Generated ${suggestions.length} friend suggestions`);

    res.status(200).json({
      success: true,
      data: {
        suggestions,
        count: suggestions.length
      }
    });

  } catch (error) {
    console.error('❌ Get friend suggestions error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// LOG: Friend controller loaded successfully
console.log('✅ Friend Controller loaded successfully');
console.log('📋 Available controllers:');
console.log('   sendFriendRequest - Send friend request');
console.log('   acceptFriendRequest - Accept friend request');
console.log('   rejectFriendRequest - Reject friend request');
console.log('   blockUser - Block user');
console.log('   removeFriend - Remove friend');
console.log('   getFriends - Get friends list');
console.log('   getFriendRequests - Get friend requests');
console.log('   getFriendSuggestions - Get friend suggestions');

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  blockUser,
  removeFriend,
  getFriends,
  getFriendRequests,
  getFriendSuggestions
};