const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");

// Store online users and their socket connections
const onlineUsers = new Map();
const userSockets = new Map(); // userId -> Set of socketIds

// Socket.IO Authentication Middleware
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
    
    if (!token) {
      console.warn(`[Socket Auth] No token provided for socket ${socket.id}`);
      return next(new Error('Authentication error: No token provided'));
    }
    
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace('Bearer ', '');
    
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET || "your_jwt_secret");
    const user = await User.findById(decoded.id).select('name username avatar');
    
    if (!user) {
      console.warn(`[Socket Auth] User not found for token in socket ${socket.id}`);
      return next(new Error('Authentication error: User not found'));
    }
    
    socket.userId = user._id.toString();
    socket.user = user;
    
    console.log(`[Socket Auth] User ${user.username} authenticated for socket ${socket.id}`);
    next();
    
  } catch (error) {
    console.error(`[Socket Auth] Authentication failed for socket ${socket.id}:`, error.message);
    next(new Error('Authentication error: Invalid token'));
  }
};

// Handle user connection
const handleConnection = (socket) => {
  const userId = socket.userId;
  const user = socket.user;
  
  console.log(`[Socket Connection] User ${user.username} (${userId}) connected with socket ${socket.id}`);
  
  // Add user to online users
  onlineUsers.set(userId, {
    ...user.toObject(),
    lastSeen: new Date(),
    isOnline: true
  });
  
  // Track multiple socket connections for same user
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socket.id);
  
  // Notify others that this user is online
  socket.broadcast.emit('user:online', {
    userId,
    user: user.toObject(),
    timestamp: new Date().toISOString()
  });
  
  console.log(`[Online Users] Total online: ${onlineUsers.size}`);
  
  // Send current online users to the newly connected user
  socket.emit('users:online', {
    onlineUsers: Array.from(onlineUsers.values()),
    timestamp: new Date().toISOString()
  });
};

// Handle user disconnection
const handleDisconnection = (socket) => {
  const userId = socket.userId;
  const user = socket.user;
  
  if (!userId) return;
  
  console.log(`[Socket Disconnection] User ${user.username} (${userId}) disconnected socket ${socket.id}`);
  
  // Remove socket from user's socket set
  if (userSockets.has(userId)) {
    userSockets.get(userId).delete(socket.id);
    
    // If user has no more active sockets, mark as offline
    if (userSockets.get(userId).size === 0) {
      userSockets.delete(userId);
      
      if (onlineUsers.has(userId)) {
        onlineUsers.set(userId, {
          ...onlineUsers.get(userId),
          isOnline: false,
          lastSeen: new Date()
        });
        
        // Notify others that this user is offline
        socket.broadcast.emit('user:offline', {
          userId,
          user: user.toObject(),
          timestamp: new Date().toISOString()
        });
        
        // Remove from online users after a delay (in case of quick reconnection)
        setTimeout(() => {
          if (!userSockets.has(userId)) {
            onlineUsers.delete(userId);
            console.log(`[Online Users] User ${user.username} removed from online list`);
          }
        }, 5000); // 5 seconds delay
      }
    }
  }
  
  console.log(`[Online Users] Total online: ${onlineUsers.size}`);
};

// Join conversation room
const handleJoinConversation = async (socket, data) => {
  const { conversationId } = data;
  const userId = socket.userId;
  
  try {
    console.log(`[Join Room] User ${userId} joining conversation ${conversationId}`);
    
    // Validate conversation exists and user is participant
    const conversation = await Conversation.findById(conversationId);
    
    if (!conversation) {
      socket.emit('error', { 
        message: 'Cuộc trò chuyện không tồn tại',
        code: 'CONVERSATION_NOT_FOUND'
      });
      return;
    }
    
    if (!conversation.participants.includes(userId)) {
      socket.emit('error', {
        message: 'Bạn không có quyền truy cập cuộc trò chuyện này',
        code: 'ACCESS_DENIED'
      });
      return;
    }
    
    // Leave previous rooms (if any)
    const rooms = Array.from(socket.rooms);
    rooms.forEach(room => {
      if (room.startsWith('conversation:')) {
        socket.leave(room);
        console.log(`[Leave Room] User ${userId} left room ${room}`);
      }
    });
    
    // Join new conversation room
    const roomName = `conversation:${conversationId}`;
    socket.join(roomName);
    
    console.log(`[Join Room] User ${userId} joined room ${roomName}`);
    
    // Notify other participants
    socket.to(roomName).emit('user:joined_conversation', {
      userId,
      user: socket.user.toObject(),
      conversationId,
      timestamp: new Date().toISOString()
    });
    
    // Send confirmation to user
    socket.emit('conversation:joined', {
      conversationId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[Join Room] Error for user ${userId}:`, error);
    socket.emit('error', {
      message: 'Không thể tham gia cuộc trò chuyện',
      code: 'JOIN_ROOM_ERROR'
    });
  }
};

// Leave conversation room
const handleLeaveConversation = (socket, data) => {
  const { conversationId } = data;
  const userId = socket.userId;
  
  try {
    const roomName = `conversation:${conversationId}`;
    socket.leave(roomName);
    
    console.log(`[Leave Room] User ${userId} left conversation ${conversationId}`);
    
    // Notify other participants
    socket.to(roomName).emit('user:left_conversation', {
      userId,
      user: socket.user.toObject(),
      conversationId,
      timestamp: new Date().toISOString()
    });
    
    socket.emit('conversation:left', {
      conversationId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[Leave Room] Error for user ${userId}:`, error);
  }
};

// Handle new message via Socket.IO
const handleSendMessage = async (socket, data) => {
  const { conversationId, content, type = 'text' } = data;
  const userId = socket.userId;
  const startTime = Date.now();
  
  try {
    console.log(`[Send Message] User ${userId} sending message to conversation ${conversationId}`);
    
    // Validation
    if (!conversationId || !content || content.trim().length === 0) {
      socket.emit('message:error', {
        message: 'Dữ liệu tin nhắn không hợp lệ',
        code: 'INVALID_MESSAGE_DATA'
      });
      return;
    }
    
    if (content.trim().length > 1000) {
      socket.emit('message:error', {
        message: 'Tin nhắn không được quá 1000 ký tự',
        code: 'MESSAGE_TOO_LONG'
      });
      return;
    }
    
    // Check conversation and permissions
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      socket.emit('message:error', {
        message: 'Cuộc trò chuyện không tồn tại',
        code: 'CONVERSATION_NOT_FOUND'
      });
      return;
    }
    
    if (!conversation.participants.includes(userId)) {
      socket.emit('message:error', {
        message: 'Bạn không có quyền gửi tin nhắn',
        code: 'ACCESS_DENIED'
      });
      return;
    }
    
    // Create and save message
    const message = new Message({
      conversation: conversationId,
      sender: userId,
      content: content.trim(),
      type
    });
    
    await message.save();
    await message.populate('sender', 'name username avatar');
    
    // Update conversation
    conversation.lastMessage = message._id;
    await conversation.updateLastActivity();
    
    const endTime = Date.now();
    console.log(`[Send Message] Message ${message._id} created in ${endTime - startTime}ms`);
    
    // Emit to all participants in the room
    const roomName = `conversation:${conversationId}`;
    const messageData = {
      ...message.toObject(),
      timestamp: new Date().toISOString()
    };
    
    // Send to room (including sender)
    socket.to(roomName).emit('message:new', messageData);
    socket.emit('message:sent', messageData);
    
    console.log(`[Broadcast] Message broadcasted to room ${roomName}`);
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`[Send Message] Error for user ${userId}: ${error.message}`);
    console.error(`[Send Message] Failed after ${endTime - startTime}ms`);
    
    socket.emit('message:error', {
      message: 'Không thể gửi tin nhắn',
      code: 'SEND_MESSAGE_ERROR',
      details: error.message
    });
  }
};

// Handle typing indicators
const handleTyping = (socket, data) => {
  const { conversationId, isTyping } = data;
  const userId = socket.userId;
  
  try {
    const roomName = `conversation:${conversationId}`;
    
    if (isTyping) {
      socket.to(roomName).emit('user:typing', {
        userId,
        user: socket.user.toObject(),
        conversationId,
        timestamp: new Date().toISOString()
      });
      console.log(`[Typing] User ${userId} started typing in ${conversationId}`);
    } else {
      socket.to(roomName).emit('user:stop_typing', {
        userId,
        user: socket.user.toObject(),
        conversationId,
        timestamp: new Date().toISOString()
      });
      console.log(`[Typing] User ${userId} stopped typing in ${conversationId}`);
    }
    
  } catch (error) {
    console.error(`[Typing] Error for user ${userId}:`, error);
  }
};

// Handle message read receipt
const handleMarkAsRead = async (socket, data) => {
  const { messageId } = data;
  const userId = socket.userId;
  
  try {
    console.log(`[Mark Read] User ${userId} marking message ${messageId} as read`);
    
    const message = await Message.findById(messageId).populate('conversation');
    if (!message) {
      socket.emit('error', {
        message: 'Tin nhắn không tồn tại',
        code: 'MESSAGE_NOT_FOUND'
      });
      return;
    }
    
    if (!message.conversation.participants.includes(userId)) {
      socket.emit('error', {
        message: 'Bạn không có quyền truy cập tin nhắn này',
        code: 'ACCESS_DENIED'
      });
      return;
    }
    
    // Don't mark own messages as read
    if (message.sender.toString() === userId.toString()) {
      return;
    }
    
    await message.markAsReadBy(userId);
    
    // Notify sender that message was read
    const roomName = `conversation:${message.conversation._id}`;
    socket.to(roomName).emit('message:read', {
      messageId,
      readBy: userId,
      user: socket.user.toObject(),
      timestamp: new Date().toISOString()
    });
    
    console.log(`[Mark Read] Message ${messageId} marked as read by user ${userId}`);
    
  } catch (error) {
    console.error(`[Mark Read] Error for user ${userId}:`, error);
  }
};

// Get online status of users
const handleGetOnlineUsers = (socket) => {
  socket.emit('users:online', {
    onlineUsers: Array.from(onlineUsers.values()),
    timestamp: new Date().toISOString()
  });
};

// Main Socket.IO handler
module.exports = (io) => {
  // Apply authentication middleware
  io.use(authenticateSocket);
  
  io.on('connection', (socket) => {
    handleConnection(socket);
    
    // Chat Events
    socket.on('conversation:join', (data) => handleJoinConversation(socket, data));
    socket.on('conversation:leave', (data) => handleLeaveConversation(socket, data));
    socket.on('message:send', (data) => handleSendMessage(socket, data));
    socket.on('message:read', (data) => handleMarkAsRead(socket, data));
    socket.on('typing:start', (data) => handleTyping(socket, { ...data, isTyping: true }));
    socket.on('typing:stop', (data) => handleTyping(socket, { ...data, isTyping: false }));
    socket.on('users:get_online', () => handleGetOnlineUsers(socket));
    
    // Disconnection
    socket.on('disconnect', () => handleDisconnection(socket));
    
    console.log(`[Socket Setup] All event handlers registered for user ${socket.userId}`);
  });
  
  console.log(`[Socket.IO] Chat socket handlers initialized`);
};