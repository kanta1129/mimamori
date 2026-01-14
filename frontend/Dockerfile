FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

# Viteはデフォルトでローカルアクセスのみ許可なので --host オプションが必須
CMD ["npm", "run", "dev", "--", "--host"]