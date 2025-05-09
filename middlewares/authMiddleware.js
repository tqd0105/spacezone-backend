const jwt = require("jsonwebtoken");

// Middleware để xử lý dữ liệu nhạy cảm
const sanitizeSensitiveData = (req, res, next) => {
    // Nếu là request đăng nhập hoặc đăng ký
    if (req.path === '/login' || req.path === '/register') {
        // Xóa password khỏi request body trước khi log
        const sanitizedBody = { ...req.body };
        if (sanitizedBody.password) {
            sanitizedBody.password = '[REDACTED]';
        }
        console.log('Request body:', sanitizedBody);
    }
    next();
};

// Middleware xác thực token
const verifyToken = (req, res, next) => {
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
        console.log("✅ User từ token:", decoded);

        req.user = decoded;
        next();
    } catch (error) {
        console.error("❌ Lỗi xác thực token:", error.message);
        res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn!" });
    }
};

module.exports = {
    verifyToken,
    sanitizeSensitiveData
};
