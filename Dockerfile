FROM node:18-alpine
RUN apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev vips-dev > /dev/null 2>&1
WORKDIR /opt/app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NODE_ENV=development
RUN npm run build
EXPOSE 1337
CMD ["npm", "run", "develop"]