const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const callHandlers = require("./callSocketHandlers");

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
          }
        }, 5000); // 5 seconds delay
      }
    }
  }
};

// Join conversation room
const handleJoinConversation = async (socket, data) => {
  const { conversationId } = data;
  const userId = socket.userId;
  
  try {
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
      }
    });
    
    // Join new conversation room
    const roomName = `conversation:${conversationId}`;
    socket.join(roomName);
    
    // Force join room again after a short delay to ensure membership
    setTimeout(() => {
      socket.join(roomName);
    }, 100);
    
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
const handleSendMessage = async (socket, data, callback) => {
  const { conversationId, content, type = 'text' } = data;
  const userId = socket.userId;
  const startTime = Date.now();
  
  try {
    // Validation
    if (!conversationId || !content || content.trim().length === 0) {
      const error = {
        message: 'Dữ liệu tin nhắn không hợp lệ',
        code: 'INVALID_MESSAGE_DATA'
      };
      if (callback) callback({ error: error.message });
      socket.emit('message:error', error);
      return;
    }
    
    if (content.trim().length > 1000) {
      const error = {
        message: 'Tin nhắn không được quá 1000 ký tự',
        code: 'MESSAGE_TOO_LONG'
      };
      if (callback) callback({ error: error.message });
      socket.emit('message:error', error);
      return;
    }
    
    // Check conversation and permissions
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      const error = {
        message: 'Cuộc trò chuyện không tồn tại',
        code: 'CONVERSATION_NOT_FOUND'
      };
      if (callback) callback({ error: error.message });
      socket.emit('message:error', error);
      return;
    }
    
    if (!conversation.participants.includes(userId)) {
      const error = {
        message: 'Bạn không có quyền gửi tin nhắn',
        code: 'ACCESS_DENIED'
      };
      if (callback) callback({ error: error.message });
      socket.emit('message:error', error);
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
    
    // Emit to all participants in the room
    const roomName = `conversation:${conversationId}`;
    const messageData = {
      ...message.toObject(),
      timestamp: new Date().toISOString()
    };
    
    // Send success callback response
    if (callback) {
      callback({ 
        success: true, 
        messageId: message._id.toString(),
        message: messageData
      });
    }
    
    // Send to room (including all participants)
    const roomClients = Array.from(socket.adapter.rooms.get(roomName) || []);
    
    // Try broadcasting to room first
    if (roomClients.length > 0) {
      // Use socket.to() to exclude sender from room broadcast
      socket.to(roomName).emit('message:new', messageData);
    } else {
      // Fallback: broadcast to individual users if room is empty
      conversation.participants.forEach(participantId => {
        // Skip sender to avoid duplicate
        if (participantId.toString() === userId.toString()) return;
        
        const participantSockets = userSockets.get(participantId.toString());
        if (participantSockets) {
          participantSockets.forEach(socketId => {
            socket.nsp.to(socketId).emit('message:new', messageData);
          });
        }
      });
    }
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`[Send Message] Error for user ${userId}: ${error.message}`);
    
    // Send error callback response
    if (callback) {
      callback({ error: error.message });
    }
    
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
    } else {
      socket.to(roomName).emit('user:stop_typing', {
        userId,
        user: socket.user.toObject(),
        conversationId,
        timestamp: new Date().toISOString()
      });
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
  
  // Share userSockets reference with call handlers
  callHandlers.setUserSocketsRef(userSockets);
  
  io.on('connection', (socket) => {
    handleConnection(socket);
    
    // Chat Events
    socket.on('conversation:join', (data) => handleJoinConversation(socket, data));
    socket.on('conversation:leave', (data) => handleLeaveConversation(socket, data));
    socket.on('message:send', (data, callback) => handleSendMessage(socket, data, callback));
    socket.on('message:read', (data) => handleMarkAsRead(socket, data));
    socket.on('typing:start', (data) => handleTyping(socket, { ...data, isTyping: true }));
    socket.on('typing:stop', (data) => handleTyping(socket, { ...data, isTyping: false }));
    socket.on('users:get_online', () => handleGetOnlineUsers(socket));
    
    // Call Events
    socket.on('call:offer', (data) => callHandlers.handleCallOffer(socket, data));
    socket.on('call:answer', (data) => callHandlers.handleCallAnswer(socket, data));
    socket.on('call:ice-candidate', (data) => callHandlers.handleIceCandidate(socket, data));
    socket.on('call:decline', (data) => callHandlers.handleCallDecline(socket, data));
    socket.on('call:end', (data) => callHandlers.handleCallEnd(socket, data));
    
    // Disconnection
    socket.on('disconnect', () => {
      handleDisconnection(socket);
      callHandlers.handleUserDisconnect(socket);
    });
  });
};