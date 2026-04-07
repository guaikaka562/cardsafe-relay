# 使用轻量级 Node.js 镜像
FROM node:18-slim

# 设置工作目录
WORKDIR /app

# 复制依赖描述文件
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制所有源代码
COPY . .

# 暴露端口（Zeabur 默认通常是 8080）
EXPOSE 8080

# 启动命令
CMD ["node", "server.js"]
