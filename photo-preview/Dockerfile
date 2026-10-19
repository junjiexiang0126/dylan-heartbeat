FROM node:22-alpine
WORKDIR /app
COPY photo-preview/ ./photo-preview/
COPY ziwei_web/public/vendor/photostack/ ./ziwei_web/public/vendor/photostack/
EXPOSE 3000
CMD ["node", "photo-preview/server.js"]
