const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// 📌 Đăng ký người dùng
exports.registerUser = async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    // Validation
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin!" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Mật khẩu xác nhận không khớp!" });
    }

    // Kiểm tra email đã tồn tại chưa
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ error: "Email đã được sử dụng" });

    // Mã hóa mật khẩu
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Tạo user mới
    user = new User({ 
      name, 
      email, 
      password: hashedPassword,
      username: email.split("@")[0]
    });
    await user.save();

    // 📌 Tự động đăng nhập sau khi đăng ký
    const currentTime = new Date();
    const sessionTimeout = 2 * 60 * 60 * 1000; // 2 tiếng
    const tokenExpiration = new Date(currentTime.getTime() + sessionTimeout);

    // Tạo tokens
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "2h" });
    const refreshToken = jwt.sign({ id: user._id, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: "7d" });

    // Cập nhật session info
    await User.findByIdAndUpdate(user._id, {
      lastLoginTime: currentTime,
      tokenExpiration: tokenExpiration,
      refreshToken: refreshToken
    });

    res.status(201).json({ 
      message: "Đăng ký thành công!", 
      token,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        avatar: user.avatar
      },
      sessionExpiration: tokenExpiration
    });
  } catch (error) {
    console.error("❌ Lỗi đăng ký:", error);
    res.status(500).json({ error: "Lỗi server, vui lòng thử lại!" });
  }
};

// 📌 Đăng nhập người dùng
exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Tìm user theo email
    let user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Email hoặc mật khẩu không đúng" });

    // Kiểm tra mật khẩu
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Email hoặc mật khẩu không đúng" });

    // 📌 Cập nhật thời gian login và tạo session 2 tiếng
    const currentTime = new Date();
    const sessionTimeout = 2 * 60 * 60 * 1000; // 2 tiếng
    const tokenExpiration = new Date(currentTime.getTime() + sessionTimeout);

    // Tạo access token (2 tiếng)
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "2h" });
    
    // Tạo refresh token (7 ngày)
    const refreshToken = jwt.sign({ id: user._id, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: "7d" });

    // 📌 Cập nhật thông tin session trong database
    await User.findByIdAndUpdate(user._id, {
      lastLoginTime: currentTime,
      tokenExpiration: tokenExpiration,
      refreshToken: refreshToken
    });

    // Loại bỏ sensitive data trước khi gửi response
    const userResponse = { ...user.toObject() };
    delete userResponse.password;
    delete userResponse.refreshToken;

    res.json({ 
      message: "Đăng nhập thành công!", 
      token, 
      refreshToken,
      user: userResponse,
      sessionExpiration: tokenExpiration
    });
  } catch (error) {
    console.error("❌ Lỗi đăng nhập:", error);
    res.status(500).json({ error: "Lỗi server, vui lòng thử lại!" });
  }
};

// 📌 Lấy thông tin người dùng
exports.getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ error: "Người dùng không tồn tại" });

    res.json(user);
  } catch (error) {
    console.error("❌ Lỗi lấy thông tin user:", error);
    res.status(500).json({ error: "Lỗi server, vui lòng thử lại!" });
  }
};

// 📌 Đăng xuất người dùng (xóa session)
exports.logoutUser = async (req, res) => {
  try {
    // Xóa thông tin session khỏi database
    await User.findByIdAndUpdate(req.user.id, {
      lastLoginTime: null,
      tokenExpiration: null,
      refreshToken: null
    });

    res.json({ message: "Đăng xuất thành công!" });
  } catch (error) {
    console.error("❌ Lỗi đăng xuất:", error);
    res.status(500).json({ error: "Lỗi server, vui lòng thử lại!" });
  }
};

// 📌 Refresh Token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token không được cung cấp!" });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: "Refresh token không hợp lệ!" });
    }

    // Tìm user và kiểm tra refresh token trong database
    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ error: "Refresh token không hợp lệ!" });
    }

    // Tạo access token mới (2 tiếng)
    const currentTime = new Date();
    const sessionTimeout = 2 * 60 * 60 * 1000; // 2 tiếng
    const tokenExpiration = new Date(currentTime.getTime() + sessionTimeout);
    
    const newToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "2h" });

    // Cập nhật thời gian session
    await User.findByIdAndUpdate(user._id, {
      lastLoginTime: currentTime,
      tokenExpiration: tokenExpiration
    });

    res.json({ 
      message: "Token được làm mới thành công!",
      token: newToken,
      sessionExpiration: tokenExpiration
    });
  } catch (error) {
    console.error("❌ Lỗi refresh token:", error);
    res.status(401).json({ error: "Refresh token không hợp lệ hoặc đã hết hạn!" });
  }
};
