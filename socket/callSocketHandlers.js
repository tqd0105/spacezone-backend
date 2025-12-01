// callSocketHandlers.js - Socket.IO handlers for video/audio calls
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Store active calls
const activeCalls = new Map(); // callId -> { caller, recipient, status, type }

// Import userSockets from main chat handlers for consistency
let userSockets = new Map(); // userId -> Set of socketIds

// Set userSockets reference (called from main handler)
const setUserSocketsRef = (ref) => {
  userSockets = ref;
};

// Handle call offer
const handleCallOffer = async (socket, data) => {
  const { callId, recipientId, callType, offer, caller } = data;
  
  try {
    
    if (!socket.userId) {
      console.error(`[Call Offer] Socket has no userId`);
      socket.emit('call:error', {
        callId,
        message: 'Lỗi xác thực người dùng'
      });
      return;
    }
    
    // Get caller user information from database
    let callerInfo = caller;
    try {
      const User = require('../models/User');
      const callerUser = await User.findById(socket.userId).select('name username avatar');
      if (callerUser) {
        callerInfo = {
          id: socket.userId,
          name: callerUser.name,
          username: callerUser.username,
          avatar: callerUser.avatar
        };
      }
    } catch (err) {
      console.error(`[Call Offer] Error fetching caller info:`, err);
      // Use provided caller info as fallback
    }
    
    // Store call information
    activeCalls.set(callId, {
      caller: socket.userId,
      recipient: recipientId,
      status: 'calling',
      type: callType,
      startTime: new Date()
    });
    
    // Find recipient's socket using userSockets map
    const recipientSocketIds = userSockets.get(recipientId);
    
    if (recipientSocketIds && recipientSocketIds.size > 0) {
      // Send call offer to all recipient's sockets
      recipientSocketIds.forEach(socketId => {
        socket.to(socketId).emit('call:incoming', {
          callId,
          callType,
          offer,
          caller: callerInfo
        });
      });
    } else {
      // Recipient not online
      socket.emit('call:error', {
        callId,
        message: 'Người dùng không trực tuyến'
      });
      
      activeCalls.delete(callId);
    }
    
  } catch (error) {
    console.error(`[Call Offer] Error:`, error);
    socket.emit('call:error', {
      callId,
      message: 'Không thể thực hiện cuộc gọi'
    });
  }
};

// Handle call answer
const handleCallAnswer = async (socket, data) => {
  const { callId, answer, recipientId } = data;
  
  try {
    const call = activeCalls.get(callId);
    if (call) {
      call.status = 'connected';
      
      // Send answer to caller using userSockets
      const callerSocketIds = userSockets.get(call.caller);
      
      if (callerSocketIds && callerSocketIds.size > 0) {
        callerSocketIds.forEach(socketId => {
          socket.to(socketId).emit('call:answer', {
            callId,
            answer
          });
        });
      }
    } else {
      socket.emit('call:error', {
        callId,
        message: 'Cuộc gọi không tồn tại'
      });
    }
    
  } catch (error) {
    console.error(`[Call Answer] Error:`, error);
    socket.emit('call:error', {
      callId,
      message: 'Không thể trả lời cuộc gọi'
    });
  }
};

// Handle ICE candidate
const handleIceCandidate = async (socket, data) => {
  const { callId, candidate, recipientId } = data;
  
  try {
    // Find recipient's socket using userSockets
    const recipientSocketIds = userSockets.get(recipientId);
    
    if (recipientSocketIds && recipientSocketIds.size > 0) {
      recipientSocketIds.forEach(socketId => {
        socket.to(socketId).emit('call:ice-candidate', {
          callId,
          candidate
        });
      });
    }
    
  } catch (error) {
    console.error(`[ICE Candidate] Error:`, error);
  }
};

// Handle call decline
const handleCallDecline = async (socket, data) => {
  const { callId, recipientId } = data;
  
  try {
    const call = activeCalls.get(callId);
    if (call) {
      call.status = 'declined';
      
      // Send decline to caller using userSockets
      const callerSocketIds = userSockets.get(call.caller);
      
      if (callerSocketIds && callerSocketIds.size > 0) {
        callerSocketIds.forEach(socketId => {
          socket.to(socketId).emit('call:decline', {
            callId
          });
        });
      }
      
      // Remove call from active calls
      activeCalls.delete(callId);
    }
    
  } catch (error) {
    console.error(`[Call Decline] Error:`, error);
  }
};

// Handle call end
const handleCallEnd = async (socket, data) => {
  const { callId, recipientId } = data;
  
  try {
    const call = activeCalls.get(callId);
    if (call) {
      call.status = 'ended';
      call.endTime = new Date();
      
    // Send end signal to other participant
    const otherUserId = call.caller === socket.userId ? call.recipient : call.caller;
    const otherSocketIds = userSockets?.get(otherUserId);
    
    if (otherSocketIds && otherSocketIds.size > 0) {
      otherSocketIds.forEach(socketId => {
        socket.to(socketId).emit('call:end', {
          callId
        });
      });
    }      // Calculate call duration
      const duration = Math.floor((call.endTime - call.startTime) / 1000);
      
      // Remove call from active calls
      activeCalls.delete(callId);
    }
    
  } catch (error) {
    console.error(`[Call End] Error:`, error);
  }
};

// Handle user disconnect - end any active calls
const handleUserDisconnect = (socket) => {
  const userId = socket.userId;
  
  if (!userId) return;
  
  // Find and end any active calls for this user
  for (const [callId, call] of activeCalls.entries()) {
    if (call.caller === userId || call.recipient === userId) {
      const otherUserId = call.caller === userId ? call.recipient : call.caller;
      const otherSocketId = userSockets?.get(otherUserId);
      
      if (otherSocketId) {
        socket.to(otherSocketId).emit('call:end', {
          callId,
          reason: 'Người dùng đã ngắt kết nối'
        });
      }
      
      activeCalls.delete(callId);
    }
  }
};

// Get active calls for debugging
const getActiveCalls = () => {
  const calls = Array.from(activeCalls.entries()).map(([callId, call]) => ({
    callId,
    ...call
  }));
  
  return calls;
};

module.exports = {
  handleCallOffer,
  handleCallAnswer,
  handleIceCandidate,
  handleCallDecline,
  handleCallEnd,
  handleUserDisconnect,
  getActiveCalls,
  setUserSocketsRef
};