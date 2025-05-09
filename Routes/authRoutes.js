const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();
const { verifyToken, sanitizeSensitiveData } = require("../middlewares/authMiddleware");

// Cache để lưu trữ thông tin đăng nhập gần đây
const loginCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 phút

// 📌 Kiểm tra API hoạt động
router.get("/", (req, res) => {
  res.send("✅ Auth API is working!");
});

router.get("/register", (req, res) => {
  res.send("✅ API /auth/register đang hoạt động (chỉ hỗ trợ POST)");
});

// 📌 Đăng ký
router.post("/register", sanitizeSensitiveData, async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin!" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Mật khẩu xác nhận không khớp!" });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ error: "Email đã được sử dụng!" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      username: email.split("@")[0]
    });

    await newUser.save();

    res.status(201).json({
      message: "Đăng ký thành công!",
      user: { id: newUser._id, name: newUser.name, email: newUser.email }
    });
  } catch (error) {
    console.error("❌ Lỗi đăng ký:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// Login
router.post("/login", sanitizeSensitiveData, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin!" });
    }

    // Kiểm tra cache trước
    const cacheKey = `${email}:${password}`;
    const cachedData = loginCache.get(cacheKey);
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      return res.json(cachedData.data);
    }

    // Tìm user và kiểm tra mật khẩu trong một query
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(400).json({ error: "Email không tồn tại" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Sai mật khẩu" });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "your_jwt_secret",
      { expiresIn: "12h" }
    );

    const responseData = {
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        avatar: user.avatar
      }
    };

    // Lưu vào cache
    loginCache.set(cacheKey, {
      data: responseData,
      timestamp: Date.now()
    });

    // Cập nhật lịch sử đăng nhập bất đồng bộ
    user.loginHistory.push({
      id: req.body.ip || req.ip,
      userAgent: req.body.userAgent || req.headers['user-agent'],
      time: new Date()
    });
    user.save().catch(err => console.error("Lỗi cập nhật lịch sử đăng nhập:", err));

    res.json(responseData);
  } catch (error) {
    console.error("❌ Lỗi đăng nhập:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// 📌 Lấy thông tin user
router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user" });
    }
    res.json(user);
  } catch (error) {
    console.error("❌ Lỗi lấy thông tin user:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

module.exports = router;
