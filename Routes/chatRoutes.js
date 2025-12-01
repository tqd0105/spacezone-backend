const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const chatController = require("../controllers/chatController");

// 📌 Kiểm tra API hoạt động
router.get("/", (req, res) => {
  console.log("📋 [Chat Routes] Health check endpoint called");
  res.send("✅ Chat API is working!");
});

// 📌 Lấy danh sách conversations của user
router.get("/conversations", authMiddleware, chatController.getConversations);

// 📌 Tạo hoặc lấy conversation giữa 2 users
router.post("/conversations", authMiddleware, chatController.createOrGetConversation);

// 📌 Lấy messages trong một conversation
router.get("/conversations/:conversationId/messages", authMiddleware, chatController.getMessages);

// 📌 Gửi message mới
router.post("/conversations/:conversationId/messages", authMiddleware, chatController.sendMessage);

// 📌 Đánh dấu message đã đọc
router.put("/messages/:messageId/read", authMiddleware, chatController.markMessageAsRead);

// 📌 Lấy số lượng tin nhắn chưa đọc trong conversation
router.get("/conversations/:conversationId/unread-count", authMiddleware, chatController.getUnreadCount);

// 📌 Xóa tất cả tin nhắn trong conversation
router.delete("/conversations/:conversationId/messages", authMiddleware, chatController.clearAllMessages);

module.exports = router;