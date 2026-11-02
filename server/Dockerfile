FROM node:20-slim
WORKDIR /app
COPY package.json index.js google.js providers.js prompts.js ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "index.js"]
