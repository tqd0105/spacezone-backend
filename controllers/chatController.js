const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const Friend = require("../models/Friend");
const mongoose = require("mongoose");

// 📌 Validation helpers
const validateObjectId = (id, fieldName = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`${fieldName} không hợp lệ`);
  }
};

const validatePaginationParams = (page, limit) => {
  const parsedPage = parseInt(page) || 1;
  const parsedLimit = Math.min(parseInt(limit) || 50, 100); // Max 100 messages per request
  
  if (parsedPage < 1) {
    throw new Error("Trang phải lớn hơn 0");
  }
  
  if (parsedLimit < 1) {
    throw new Error("Limit phải lớn hơn 0");
  }
  
  return { page: parsedPage, limit: parsedLimit };
};

// 📌 Lấy danh sách conversations của user
exports.getConversations = async (req, res) => {
  const startTime = Date.now();
  const userId = req.user.id;
  
  try {
    console.log(`📋 [Controller.getConversations] User ${userId} requesting conversations`);
    
    validateObjectId(userId, "User ID");
    
    const t1 = Date.now();
    const conversations = await Conversation.findByUserId(userId);
    const t2 = Date.now();
    console.log(`⏱️ [Controller.getConversations] Database query took: ${t2 - t1}ms`);
    
    // Add unread count for each conversation
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conversation) => {
        const t3 = Date.now();
        const unreadCount = await Message.getUnreadCount(conversation._id, userId);
        const t4 = Date.now();
        console.log(`⏱️ [Controller.getConversations] Unread count for ${conversation._id} took: ${t4 - t3}ms`);
        
        // 🔐 Check friendship status for each conversation
        let friendshipStatus = null;
        const otherParticipant = conversation.participants.find(p => p._id.toString() !== userId.toString());
        
        if (otherParticipant) {
          const t_friend = Date.now();
          const friendship = await Friend.checkFriendship(userId, otherParticipant._id);
          const t_friend_end = Date.now();
          console.log(`⏱️ [Controller.getConversations] Friend check for ${conversation._id} took: ${t_friend_end - t_friend}ms`);
          
          friendshipStatus = friendship?.status || 'none';
        }
        
        return {
          ...conversation.toObject(),
          unreadCount,
          friendshipStatus
        };
      })
    );
    
    const endTime = Date.now();
    console.log(`✅ [Controller.getConversations] Success for user ${userId}, found ${conversationsWithUnread.length} conversations, total time: ${endTime - startTime}ms`);
    
    res.json({
      success: true,
      conversations: conversationsWithUnread,
      count: conversationsWithUnread.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ [Controller.getConversations] Error for user ${userId}:`, error.message);
    console.error(`⏱️ [Controller.getConversations] Request failed after: ${endTime - startTime}ms`);
    
    res.status(error.message.includes("không hợp lệ") ? 400 : 500).json({ 
      success: false,
      error: error.message || "Không thể lấy danh sách cuộc trò chuyện",
      timestamp: new Date().toISOString()
    });
  }
};

// 📌 Tạo hoặc lấy conversation giữa 2 users
exports.createOrGetConversation = async (req, res) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const { recipientId } = req.body;
  
  try {
    
    // Validation
    if (!recipientId) {
      throw new Error("recipientId is required");
    }
    
    validateObjectId(userId, "User ID");
    validateObjectId(recipientId, "Recipient ID");
    
    if (userId === recipientId) {
      throw new Error("Không thể tạo cuộc trò chuyện với chính mình");
    }
    
    // Check if recipient exists
    const t1 = Date.now();
    const recipient = await User.findById(recipientId).select("name username avatar");
    const t2 = Date.now();
    console.log(`⏱️ [Controller.createOrGetConversation] Recipient lookup took: ${t2 - t1}ms`);
    
    if (!recipient) {
      throw new Error("Người dùng không tồn tại");
    }

    // 🔐 CHECK FRIENDSHIP STATUS - Only allow chat between friends
    const t_friend = Date.now();
    const friendship = await Friend.checkFriendship(userId, recipientId);
    const t_friend_end = Date.now();
    console.log(`⏱️ [Controller.createOrGetConversation] Friend check took: ${t_friend_end - t_friend}ms`);
    
    if (!friendship || friendship.status !== 'accepted') {
      console.log(`❌ [Controller.createOrGetConversation] Users are not friends. Friendship status: ${friendship?.status || 'none'}`);
      throw new Error("Chỉ có thể nhắn tin với bạn bè. Vui lòng gửi lời mời kết bạn trước!");
    }
    
    console.log(`✅ [Controller.createOrGetConversation] Users are friends, allowing chat creation`);
    
    // Check if conversation already exists
    const t3 = Date.now();
    let conversation = await Conversation.findBetweenUsers(userId, recipientId);
    const t4 = Date.now();
    console.log(`⏱️ [Controller.createOrGetConversation] Conversation lookup took: ${t4 - t3}ms`);
    
    if (conversation) {
      console.log(`📋 [Controller.createOrGetConversation] Found existing conversation ${conversation._id}`);
      
      const endTime = Date.now();
      console.log(`✅ [Controller.createOrGetConversation] Returning existing conversation, total time: ${endTime - startTime}ms`);
      
      return res.json({
        success: true,
        conversation,
        isNew: false,
        timestamp: new Date().toISOString()
      });
    }
    
    // Create new conversation using transaction for data consistency
    const t5 = Date.now();
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        conversation = new Conversation({
          participants: [userId, recipientId],
          type: "private"
        });
        
        await conversation.save({ session });
        await conversation.populate('participants', 'name username avatar');
      });
      
      await session.endSession();
      const t6 = Date.now();
      console.log(`⏱️ [Controller.createOrGetConversation] New conversation creation took: ${t6 - t5}ms`);
      
    } catch (transactionError) {
      await session.endSession();
      throw transactionError;
    }
    
    const endTime = Date.now();
    console.log(`✅ [Controller.createOrGetConversation] Created new conversation ${conversation._id}, total time: ${endTime - startTime}ms`);
    
    res.status(201).json({
      success: true,
      conversation,
      isNew: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ [Controller.createOrGetConversation] Error for user ${userId}:`, error.message);
    console.error(`⏱️ [Controller.createOrGetConversation] Request failed after: ${endTime - startTime}ms`);
    
    const statusCode = error.message.includes("required") || 
                      error.message.includes("không hợp lệ") || 
                      error.message.includes("chính mình") ? 400 :
                      error.message.includes("không tồn tại") ? 404 : 500;
    
    res.status(statusCode).json({ 
      success: false,
      error: error.message || "Không thể tạo cuộc trò chuyện",
      timestamp: new Date().toISOString()
    });
  }
};

// 📌 Lấy messages trong một conversation
exports.getMessages = async (req, res) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const { conversationId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  
  try {
    console.log(`📋 [Controller.getMessages] User ${userId} requesting messages from conversation ${conversationId}`);
    
    validateObjectId(conversationId, "Conversation ID");
    validateObjectId(userId, "User ID");
    
    const { page: validPage, limit: validLimit } = validatePaginationParams(page, limit);
    console.log(`📋 [Controller.getMessages] Validated pagination: page=${validPage}, limit=${validLimit}`);
    
    // Check if user is participant in this conversation
    const t1 = Date.now();
    const conversation = await Conversation.findById(conversationId);
    const t2 = Date.now();
    console.log(`⏱️ [Controller.getMessages] Conversation lookup took: ${t2 - t1}ms`);
    
    if (!conversation) {
      throw new Error("Cuộc trò chuyện không tồn tại");
    }
    
    if (!conversation.participants.includes(userId)) {
      throw new Error("Bạn không có quyền truy cập cuộc trò chuyện này");
    }
    
    // Get messages with pagination
    const t3 = Date.now();
    const messages = await Message.findInConversation(conversationId, validPage, validLimit);
    const t4 = Date.now();
    console.log(`⏱️ [Controller.getMessages] Messages query took: ${t4 - t3}ms`);
    
    // Reverse to show newest at bottom (chat style)
    messages.reverse();
    
    // Get total count for pagination info (cached for performance)
    const t5 = Date.now();
    const totalMessages = await Message.countDocuments({ 
      conversation: conversationId, 
      isDeleted: false 
    });
    const t6 = Date.now();
    console.log(`⏱️ [Controller.getMessages] Count query took: ${t6 - t5}ms`);
    
    const totalPages = Math.ceil(totalMessages / validLimit);
    const hasMore = validPage < totalPages;
    
    const endTime = Date.now();
    console.log(`✅ [Controller.getMessages] Success for user ${userId}, found ${messages.length}/${totalMessages} messages, total time: ${endTime - startTime}ms`);
    
    res.json({
      success: true,
      messages,
      pagination: {
        page: validPage,
        limit: validLimit,
        totalMessages,
        totalPages,
        hasMore
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ [Controller.getMessages] Error for user ${userId}:`, error.message);
    console.error(`⏱️ [Controller.getMessages] Request failed after: ${endTime - startTime}ms`);
    
    const statusCode = error.message.includes("không hợp lệ") || 
                      error.message.includes("phải lớn hơn") ? 400 :
                      error.message.includes("không tồn tại") ? 404 :
                      error.message.includes("không có quyền") ? 403 : 500;
    
    res.status(statusCode).json({ 
      success: false,
      error: error.message || "Không thể lấy tin nhắn",
      timestamp: new Date().toISOString()
    });
  }
};

// 📌 Gửi message mới
exports.sendMessage = async (req, res) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const { conversationId } = req.params;
  const { content, type = "text", sharedPost } = req.body;
  
  try {
    console.log(`📋 [Controller.sendMessage] User ${userId} sending message to conversation ${conversationId}`);
    
    // Validation
    validateObjectId(conversationId, "Conversation ID");
    validateObjectId(userId, "User ID");
    
    if (!content || content.trim().length === 0) {
      throw new Error("Nội dung tin nhắn không thể để trống");
    }
    
    if (content.trim().length > 1000) {
      throw new Error("Nội dung tin nhắn không được quá 1000 ký tự");
    }
    
    const validTypes = ["text", "image", "file", "share"];
    if (!validTypes.includes(type)) {
      throw new Error("Loại tin nhắn không hợp lệ");
    }
    
    console.log(`📋 [Controller.sendMessage] Message validation passed: length=${content.trim().length}, type=${type}`);
    
    // Check if user is participant in this conversation
    const t1 = Date.now();
    const conversation = await Conversation.findById(conversationId);
    const t2 = Date.now();
    console.log(`⏱️ [Controller.sendMessage] Conversation lookup took: ${t2 - t1}ms`);
    
    if (!conversation) {
      throw new Error("Cuộc trò chuyện không tồn tại");
    }
    
    if (!conversation.participants.includes(userId)) {
      throw new Error("Bạn không có quyền gửi tin nhắn trong cuộc trò chuyện này");
    }

    // 🔐 CHECK FRIENDSHIP STATUS - Only allow messaging between friends
    const otherParticipant = conversation.participants.find(p => p.toString() !== userId.toString());
    if (otherParticipant) {
      const t_friend = Date.now();
      const friendship = await Friend.checkFriendship(userId, otherParticipant);
      const t_friend_end = Date.now();
      console.log(`⏱️ [Controller.sendMessage] Friend check took: ${t_friend_end - t_friend}ms`);
      
      if (!friendship || friendship.status !== 'accepted') {
        console.log(`❌ [Controller.sendMessage] Users are not friends. Friendship status: ${friendship?.status || 'none'}`);
        throw new Error("Chỉ có thể nhắn tin với bạn bè. Cuộc trò chuyện này không còn khả dụng!");
      }
      
      console.log(`✅ [Controller.sendMessage] Users are still friends, allowing message send`);
    }
    
    // Create and save message using transaction
    const t3 = Date.now();
    let message;
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        const messageData = {
          conversation: conversationId,
          sender: userId,
          content: content.trim(),
          type
        };
        
        // Add sharedPost data if message type is 'share'
        if (type === 'share' && sharedPost) {
          messageData.sharedPost = sharedPost;
        }
        
        message = new Message(messageData);
        
        await message.save({ session });
        await message.populate('sender', 'name username avatar');
        
        // Update conversation last message and activity
        conversation.lastMessage = message._id;
        await conversation.updateLastActivity();
      });
      
      await session.endSession();
      const t4 = Date.now();
      console.log(`⏱️ [Controller.sendMessage] Message creation transaction took: ${t4 - t3}ms`);
      
    } catch (transactionError) {
      await session.endSession();
      throw transactionError;
    }
    
    const endTime = Date.now();
    console.log(`✅ [Controller.sendMessage] Message ${message._id} sent successfully, total time: ${endTime - startTime}ms`);
    
    // Emit real-time notification via Socket.IO
    const io = req.app.get('io');
    if (io) {
      const roomName = `conversation:${conversationId}`;
      const messageData = {
        ...message.toObject(),
        timestamp: new Date().toISOString()
      };
      
      // Broadcast to all users in the conversation room
      io.to(roomName).emit('message:new', messageData);
      console.log(`📡 [Controller.sendMessage] Message broadcasted via Socket.IO to room ${roomName}`);
    }
    
    res.status(201).json({
      success: true,
      message,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ [Controller.sendMessage] Error for user ${userId}:`, error.message);
    console.error(`⏱️ [Controller.sendMessage] Request failed after: ${endTime - startTime}ms`);
    
    const statusCode = error.message.includes("không thể để trống") || 
                      error.message.includes("quá 1000") ||
                      error.message.includes("không hợp lệ") ? 400 :
                      error.message.includes("không tồn tại") ? 404 :
                      error.message.includes("không có quyền") ? 403 : 500;
    
    res.status(statusCode).json({ 
      success: false,
      error: error.message || "Không thể gửi tin nhắn",
      timestamp: new Date().toISOString()
    });
  }
};

// 📌 Đánh dấu message đã đọc
exports.markMessageAsRead = async (req, res) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const { messageId } = req.params;
  
  try {
    console.log(`📋 [Controller.markMessageAsRead] User ${userId} marking message ${messageId} as read`);
    
    validateObjectId(messageId, "Message ID");
    validateObjectId(userId, "User ID");
    
    const t1 = Date.now();
    const message = await Message.findById(messageId).populate('conversation');
    const t2 = Date.now();
    console.log(`⏱️ [Controller.markMessageAsRead] Message lookup took: ${t2 - t1}ms`);
    
    if (!message) {
      throw new Error("Tin nhắn không tồn tại");
    }
    
    if (message.isDeleted) {
      throw new Error("Tin nhắn đã bị xóa");
    }
    
    // Check if user is participant in the conversation
    if (!message.conversation.participants.includes(userId)) {
      throw new Error("Bạn không có quyền truy cập tin nhắn này");
    }
    
    // Don't mark own messages as read
    if (message.sender.toString() === userId.toString()) {
      console.log(`📋 [Controller.markMessageAsRead] User ${userId} tried to mark own message as read`);
      return res.json({
        success: true,
        message: "Không thể đánh dấu tin nhắn của chính mình đã đọc",
        timestamp: new Date().toISOString()
      });
    }
    
    // Mark as read
    const t3 = Date.now();
    await message.markAsReadBy(userId);
    const t4 = Date.now();
    console.log(`⏱️ [Controller.markMessageAsRead] Mark as read took: ${t4 - t3}ms`);
    
    const endTime = Date.now();
    console.log(`✅ [Controller.markMessageAsRead] Message marked as read successfully, total time: ${endTime - startTime}ms`);
    
    res.json({
      success: true,
      message: "Đã đánh dấu tin nhắn đã đọc",
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ [Controller.markMessageAsRead] Error for user ${userId}:`, error.message);
    console.error(`⏱️ [Controller.markMessageAsRead] Request failed after: ${endTime - startTime}ms`);
    
    const statusCode = error.message.includes("không hợp lệ") ? 400 :
                      error.message.includes("không tồn tại") ||
                      error.message.includes("đã bị xóa") ? 404 :
                      error.message.includes("không có quyền") ? 403 : 500;
    
    res.status(statusCode).json({ 
      success: false,
      error: error.message || "Không thể đánh dấu tin nhắn đã đọc",
      timestamp: new Date().toISOString()
    });
  }
};

// 📌 Lấy số lượng tin nhắn chưa đọc trong conversation
exports.getUnreadCount = async (req, res) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const { conversationId } = req.params;
  
  try {
    console.log(`📋 [Controller.getUnreadCount] User ${userId} requesting unread count for conversation ${conversationId}`);
    
    validateObjectId(conversationId, "Conversation ID");
    validateObjectId(userId, "User ID");
    
    // Check if user is participant
    const t1 = Date.now();
    const conversation = await Conversation.findById(conversationId);
    const t2 = Date.now();
    console.log(`⏱️ [Controller.getUnreadCount] Conversation lookup took: ${t2 - t1}ms`);
    
    if (!conversation) {
      throw new Error("Cuộc trò chuyện không tồn tại");
    }
    
    if (!conversation.participants.includes(userId)) {
      throw new Error("Bạn không có quyền truy cập cuộc trò chuyện này");
    }
    
    const t3 = Date.now();
    const unreadCount = await Message.getUnreadCount(conversationId, userId);
    const t4 = Date.now();
    console.log(`⏱️ [Controller.getUnreadCount] Unread count query took: ${t4 - t3}ms`);
    
    const endTime = Date.now();
    console.log(`✅ [Controller.getUnreadCount] Found ${unreadCount} unread messages, total time: ${endTime - startTime}ms`);
    
    res.json({
      success: true,
      unreadCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ [Controller.getUnreadCount] Error for user ${userId}:`, error.message);
    console.error(`⏱️ [Controller.getUnreadCount] Request failed after: ${endTime - startTime}ms`);
    
    const statusCode = error.message.includes("không hợp lệ") ? 400 :
                      error.message.includes("không tồn tại") ? 404 :
                      error.message.includes("không có quyền") ? 403 : 500;
    
    res.status(statusCode).json({ 
      success: false,
      error: error.message || "Không thể lấy số lượng tin nhắn chưa đọc",
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * @desc    Xóa tất cả tin nhắn trong conversation
 * @route   DELETE /api/chat/conversations/:conversationId/messages
 * @access  Private
 */
const clearAllMessages = async (req, res) => {
  const startTime = Date.now();
  const { conversationId } = req.params;
  const userId = req.user.id;

  try {
    console.log(`🗑️ [Controller.clearAllMessages] User ${userId} clearing messages in conversation ${conversationId}`);

    // Validate conversation ID
    validateObjectId(conversationId, "Conversation ID");

    // Check if conversation exists and user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error("Conversation không tồn tại");
    }

    // Check if user is participant in the conversation
    const isParticipant = conversation.participants.some(
      participantId => participantId.toString() === userId
    );

    if (!isParticipant) {
      throw new Error("Bạn không có quyền truy cập conversation này");
    }

    // Check existing messages first
    const existingMessages = await Message.find({ conversation: conversationId });
    console.log(`🔍 [Controller.clearAllMessages] Found ${existingMessages.length} messages to delete`);
    
    // Delete all messages in the conversation
    const deleteResult = await Message.deleteMany({
      conversation: conversationId
    });

    console.log(`🗑️ [Controller.clearAllMessages] Deleted ${deleteResult.deletedCount} messages from conversation ${conversationId}`);

    // Update conversation's lastMessage to null and lastActivity
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: null,
      lastActivity: new Date()
    });

    const endTime = Date.now();
    console.log(`✅ [Controller.clearAllMessages] Successfully cleared ${deleteResult.deletedCount} messages in ${endTime - startTime}ms`);

    res.status(200).json({
      success: true,
      message: `Đã xóa ${deleteResult.deletedCount} tin nhắn`,
      data: {
        conversationId,
        deletedCount: deleteResult.deletedCount
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ [Controller.clearAllMessages] Error for user ${userId}:`, error.message);
    console.error(`⏱️ [Controller.clearAllMessages] Request failed after: ${endTime - startTime}ms`);
    
    const statusCode = error.message.includes("không hợp lệ") ? 400 :
                      error.message.includes("không tồn tại") ? 404 :
                      error.message.includes("không có quyền") ? 403 : 500;
    
    res.status(statusCode).json({ 
      success: false,
      error: error.message || "Không thể xóa tin nhắn",
      timestamp: new Date().toISOString()
    });
  }
};

exports.clearAllMessages = clearAllMessages;