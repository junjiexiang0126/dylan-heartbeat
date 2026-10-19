FROM node:22-alpine
WORKDIR /app
COPY chat-photo-preview/ ./chat-photo-preview/
COPY ziwei_web/public/ ./ziwei_web/public/
EXPOSE 3000
CMD ["node","chat-photo-preview/server.js"]
