# Dùng image Node chính thức
FROM node:18-alpine

# Tạo thư mục app
WORKDIR /app

# Copy package.json và install
COPY package*.json ./
RUN npm ci --only=production

# Copy toàn bộ mã nguồn vào container
COPY . .

# Mở cổng nếu cần (Render sẽ tự động map cổng nếu dùng web service)
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000 || exit 1

# Lệnh chạy server
CMD ["npm", "start"]
