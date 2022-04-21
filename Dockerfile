FROM node:16

WORKDIR /app

# Copy creates a new layer, when package.json is changed it'll re-run the below
COPY package*.json ./
RUN npm set audit false -g
RUN npm ci

EXPOSE 4820

CMD npm run start
