const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async (req, res, next) => {
    try {
        console.log("Headers nhận được:", req.headers);

        const authHeader = req.header("Authorization");
        if (!authHeader) {
            console.log("❌ Không tìm thấy header Authorization!");
            return res.status(401).json({ error: "Bạn chưa đăng nhập!" });
        }

        const token = authHeader.replace("Bearer ", "").trim();
        if (!token) {
            console.log("❌ Token trống!");
            return res.status(401).json({ error: "Token không hợp lệ!" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 📌 Kiểm tra user và thời gian session
        const user = await User.findById(decoded.id);
        if (!user) {
            console.log("❌ User không tồn tại!");
            return res.status(401).json({ error: "Tài khoản không tồn tại!" });
        }

        // 📌 Kiểm tra session timeout (2 tiếng = 2 * 60 * 60 * 1000 ms)
        const currentTime = new Date();
        const sessionTimeout = 2 * 60 * 60 * 1000; // 2 tiếng
        
        if (user.lastLoginTime && user.tokenExpiration) {
            if (currentTime > user.tokenExpiration) {
                console.log("❌ Session đã hết hạn sau 2 tiếng!");
                
                // Xóa thông tin session khỏi database
                await User.findByIdAndUpdate(user._id, {
                    lastLoginTime: null,
                    tokenExpiration: null,
                    refreshToken: null
                });
                
                return res.status(401).json({ 
                    error: "Phiên đăng nhập đã hết hạn sau 2 tiếng. Vui lòng đăng nhập lại!",
                    isSessionExpired: true 
                });
            }
        }

        // console.log("✅ User từ token:", decoded);
        req.user = decoded;
        next();
    } catch (error) {
        console.error("❌ Lỗi xác thực token:", error.message);
        res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn!" });
    }
};
