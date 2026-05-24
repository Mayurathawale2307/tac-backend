FROM node:20

WORKDIR /app

COPY package*.json ./

# Copy Prisma schema before installing so postinstall scripts can run
COPY prisma ./prisma

RUN npm install

COPY . .

RUN npx prisma generate

EXPOSE 4000

CMD ["npm","start"]
