const express = require("express");
const multer = require("multer");
const Post = require("../models/Post");
const Friend = require("../models/Friend");
const path = require("path");
const router = express.Router();
const fs = require("fs");
const mongoose = require('mongoose');
const authMiddleware = require("../middlewares/authMiddleware");

// 📌 Cấu hình Multer (Lưu trữ file)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/post";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) return cb(null, true);
  cb(new Error("❌ Chỉ chấp nhận file ảnh (jpg, jpeg, png, gif)!"));
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // Giới hạn 5MB
  }
});

// ✅ API: Tạo bài viết (CHỈ CHO NGƯỜI DÙNG ĐÃ ĐĂNG NHẬP)
router.post("/", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    console.log("User từ token:", req.user); // 🛠 Debug xem user có đúng không

    if (!req.body.content && !req.file) {
      return res.status(400).json({ error: "❌ Nội dung hoặc ảnh không được để trống" });
    }

    const newPost = new Post({
      title: req.body.title || "Không có tiêu đề",
      content: req.body.content || "",
      author: req.user.id, // 🛠 Nếu `req.user` là `undefined`, lỗi do token không hợp lệ
      image: req.file ? `/uploads/post/${req.file.filename}` : null,
    });

    await newPost.save();
    
    // Populate user information before sending response
    const populatedPost = await Post.findById(newPost._id).populate("author", "name username avatar");
    res.status(201).json(populatedPost);
  } catch (error) {
    console.error("❌ Lỗi tạo bài viết:", error);
    res.status(500).json({ error: "❌ Lỗi server" });
  }
});


// ✅ API: Lấy danh sách bài viết (chỉ của bạn bè)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    
    console.log(`📋 [Get Posts] User ${currentUserId} requesting posts...`);
    
    // Lấy danh sách bạn bè đã được chấp nhận
    const friendships = await Friend.find({
      $or: [
        { sender: currentUserId, status: 'accepted' },
        { receiver: currentUserId, status: 'accepted' }
      ]
    });
    
    console.log(`📋 [Get Posts] Found ${friendships.length} accepted friendships`);
    
    // Tạo danh sách ID của bạn bè
    const friendIds = friendships.map(friendship => {
      return friendship.sender.toString() === currentUserId 
        ? friendship.receiver 
        : friendship.sender;
    });
    
    // Thêm ID của chính mình để xem bài viết của mình
    friendIds.push(currentUserId);
    
    console.log(`📋 [Get Posts] User ${currentUserId} has ${friendIds.length - 1} friends, getting posts from: ${friendIds}`);
    
    // Lấy bài viết của bạn bè và chính mình
    const posts = await Post.find({ 
      author: { $in: friendIds } 
    })
      .populate("author", "name username avatar")
      .sort({ createdAt: -1 });

    console.log(`📋 [Get Posts] Found ${posts.length} posts for user ${currentUserId}`);

    res.json(posts);
  } catch (error) {
    console.error("❌ Lỗi lấy danh sách bài viết:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
});

// ✅ API: Lấy bài viết theo ID (chỉ của bạn bè)
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const post = await Post.findById(req.params.id).populate("author", "name username avatar");
    
    if (!post) {
      return res.status(404).json({ message: "Bài viết không tồn tại" });
    }
    
    // Nếu là bài viết của chính mình thì cho phép xem
    if (post.author._id.toString() === currentUserId) {
      return res.json(post);
    }
    
    // Kiểm tra có phải bạn bè không
    const friendship = await Friend.findOne({
      $or: [
        { sender: currentUserId, receiver: post.author._id, status: 'accepted' },
        { sender: post.author._id, receiver: currentUserId, status: 'accepted' }
      ]
    });
    
    if (!friendship) {
      return res.status(403).json({ 
        message: "Bạn cần kết bạn để xem bài viết này",
        requiresFriendship: true 
      });
    }
    
    res.json(post);
  } catch (error) {
    console.error("❌ Lỗi lấy bài viết:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
});

// ✅ API: Cập nhật bài viết (CHỈ CHO NGƯỜI DÙNG ĐÃ ĐĂNG NHẬP)
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Bài viết không tồn tại" });
    
    // Kiểm tra quyền sửa bài viết
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({ message: "Bạn không có quyền sửa bài viết này" });
    }

    const updatedPost = await Post.findByIdAndUpdate(
      req.params.id,
      { ...req.body, author: req.user.id },
      { new: true }
    );
    
    res.json(updatedPost);
  } catch (error) {
    console.error("❌ Lỗi cập nhật bài viết:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
});

// ✅ API: Xóa bài viết (CHỈ CHO NGƯỜI DÙNG ĐÃ ĐĂNG NHẬP)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const postId = req.params.id;
    
    // Kiểm tra ID có hợp lệ không
    if (!postId || postId === "undefined") {
      return res.status(400).json({ error: "❌ ID không hợp lệ" });
    }

    // Kiểm tra xem ID có đúng định dạng MongoDB ObjectId không
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ error: "❌ ID không đúng định dạng" });
    }

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "❌ Bài viết không tồn tại" });

    // Kiểm tra quyền xóa bài viết
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({ message: "Bạn không có quyền xóa bài viết này" });
    }

    // Xóa file ảnh nếu có
    if (post.image) {
      const imagePath = path.join(__dirname, "..", post.image);
      fs.unlink(imagePath, (err) => {
        if (err) console.error("❌ Lỗi xóa file ảnh:", err);
      });
    }

    await Post.findByIdAndDelete(postId);
    res.json({ message: "✅ Đã xóa bài viết thành công" });
  } catch (error) {
    console.error("❌ Lỗi xóa bài viết:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// 📌 Xuất module
module.exports = router;
