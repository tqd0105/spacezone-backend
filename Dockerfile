# Dùng image Node chính thức
FROM node:18

# Tạo thư mục app
WORKDIR /app

# Copy package.json và install
COPY package*.json ./
RUN npm install

# Copy toàn bộ mã nguồn vào container
COPY . .

# Mở cổng nếu cần (Render sẽ tự động map cổng nếu dùng web service)
EXPOSE 3000

# Lệnh chạy server
CMD ["npm", "start"]
