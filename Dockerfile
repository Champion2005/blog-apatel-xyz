FROM node:20-alpine
WORKDIR /app

# 1. Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# 2. Install dependencies (This layer gets cached instantly unless you change dependencies)
RUN npm ci

# 3. Copy the rest of the application code
COPY . .

# 4. Build the Vite frontend
RUN npm run build

EXPOSE 3000

# 5. Start the Express server
CMD ["npm", "start"]
