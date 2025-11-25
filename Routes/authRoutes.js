const express = require("express");
const authController = require("../controllers/authController");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

// 📌 Kiểm tra API hoạt động
router.get("/", (req, res) => {
  res.send("✅ Auth API is working!");
});

router.get("/register", (req, res) => {
  res.send("✅ API /auth/register đang hoạt động (chỉ hỗ trợ POST)");
});

// 📌 Sử dụng AuthController
router.post("/register", authController.registerUser);
router.post("/login", authController.loginUser);
router.get("/me", authMiddleware, authController.getUserProfile);

// 📌 Thêm routes mới cho auto-logout
router.post("/logout", authMiddleware, authController.logoutUser);
router.post("/refresh-token", authController.refreshToken);

module.exports = router;
