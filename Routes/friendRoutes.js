const express = require('express');
const router = express.Router();
const {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  blockUser,
  getFriends,
  getFriendRequests,
  removeFriend,
  getFriendSuggestions
} = require('../controllers/friendController');
const authMiddleware = require('../middlewares/authMiddleware');

// LOG: Friend routes initialization
console.log('🔗 Initializing Friend routes...');

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @route   POST /api/friends/send-request
 * @desc    Send friend request to another user
 * @access  Private
 * @body    { receiverId: ObjectId }
 */
router.post('/send-request', sendFriendRequest);

/**
 * @route   POST /api/friends/accept/:requestId
 * @desc    Accept friend request
 * @access  Private
 * @params  requestId - Friend request ID to accept
 */
router.post('/accept/:requestId', acceptFriendRequest);

/**
 * @route   POST /api/friends/reject/:requestId  
 * @desc    Reject friend request
 * @access  Private
 * @params  requestId - Friend request ID to reject
 */
router.post('/reject/:requestId', rejectFriendRequest);

/**
 * @route   POST /api/friends/block/:userId
 * @desc    Block a user (prevents all interactions)
 * @access  Private
 * @params  userId - User ID to block
 */
router.post('/block/:userId', blockUser);

/**
 * @route   DELETE /api/friends/remove/:friendId
 * @desc    Remove/unfriend a user
 * @access  Private
 * @params  friendId - Friend ID to remove
 */
router.delete('/remove/:friendId', removeFriend);

/**
 * @route   GET /api/friends/list
 * @desc    Get user's friends list with pagination
 * @access  Private
 * @query   page, limit, search
 */
router.get('/list', getFriends);

/**
 * @route   GET /api/friends/requests
 * @desc    Get friend requests (received and sent)
 * @access  Private
 * @query   type (received|sent), page, limit
 */
router.get('/requests', getFriendRequests);

/**
 * @route   GET /api/friends/suggestions
 * @desc    Get friend suggestions based on mutual connections
 * @access  Private
 * @query   limit
 */
router.get('/suggestions', getFriendSuggestions);

// LOG: Friend routes loaded successfully
console.log('✅ Friend routes loaded successfully');
console.log('📋 Available endpoints:');
console.log('   POST /send-request - Send friend request');
console.log('   POST /accept/:requestId - Accept friend request');
console.log('   POST /reject/:requestId - Reject friend request');  
console.log('   POST /block/:userId - Block user');
console.log('   DELETE /remove/:friendId - Remove friend');
console.log('   GET /list - Get friends list');
console.log('   GET /requests - Get friend requests');
console.log('   GET /suggestions - Get friend suggestions');

module.exports = router;