# OpenRouter Credit Monitor

Công cụ tự động theo dõi số dư credit của OpenRouter và gửi thông báo qua Telegram khi số dư thấp hơn ngưỡng đã đặt.

A tool to automatically monitor your OpenRouter credit balance and send Telegram notifications when the balance falls below a set threshold.

## Features / Tính năng

- Tự động kiểm tra số dư OpenRouter theo định kỳ
- Gửi cảnh báo qua Telegram khi số dư < $4 (có thể tùy chỉnh)
- Cooldown 1 giờ giữa các cảnh báo để tránh spam
- Hiển thị thông tin chi tiết: tổng credit, đã sử dụng, còn lại
- Chạy nền liên tục với node-cron

## Prerequisites / Yêu cầu

- Node.js >= 18.x
- OpenRouter API Key
- Telegram Bot Token và Chat ID

## Installation / Cài đặt

### 1. Cài đặt dependencies

```bash
npm install
```

### 2. Tạo file .env

Copy file `.env.example` thành `.env`:

```bash
cp .env.example .env
```

### 3. Cấu hình .env file

Mở file `.env` và điền thông tin:

```env
# OpenRouter API Key - Lấy từ https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxx

# Telegram Bot Token - Tạo bot mới với @BotFather trên Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Telegram Chat ID - ID của chat hoặc user nhận thông báo
TELEGRAM_CHAT_ID=123456789

# Ngưỡng cảnh báo (đô la)
BALANCE_THRESHOLD=4

# Tần suất kiểm tra (phút)
CHECK_INTERVAL_MINUTES=30
```

## Hướng dẫn lấy thông tin cấu hình

### Lấy OpenRouter API Key

1. Truy cập https://openrouter.ai/keys
2. Đăng nhập vào tài khoản
3. Tạo API key mới hoặc copy key hiện có

### Lấy Telegram Bot Token

1. Mở Telegram và tìm bot `@BotFather`
2. Gửi lệnh `/newbot`
3. Đặt tên cho bot của bạn
4. Copy Bot Token (dạng: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Lấy Telegram Chat ID

**Cách 1: Dùng bot**
1. Tìm bot `@userinfobot` trên Telegram
2. Gửi tin nhắn bất kỳ
3. Bot sẽ trả về Chat ID của bạn

**Cách 2: Dùng API**
1. Gửi tin nhắn cho bot của bạn
2. Truy cập: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. Tìm `"chat":{"id":123456789}` trong response

## Usage / Sử dụng

### Development mode (TypeScript trực tiếp)

```bash
npm run dev
```

### Production mode (Build và chạy)

```bash
npm run build
npm start
```

### Hoặc dùng script tổng hợp

```bash
npm run monitor
```

## Docker Deployment (Khuyến nghị cho VPS)

### Chuẩn bị

Đảm bảo VPS đã cài Docker và Docker Compose:

```bash
# Kiểm tra Docker
docker --version
docker-compose --version
```

### Cách 1: Dùng Docker Compose (Đơn giản nhất)

**Bước 1:** Upload toàn bộ project lên VPS

```bash
# Từ máy local
scp -r monitor-money/ user@your-vps-ip:/path/to/
```

**Bước 2:** Trên VPS, điền thông tin vào `.env`

```bash
cd /path/to/monitor-money
nano .env
```

**Bước 3:** Build và chạy container

```bash
# Build và start container
docker-compose up -d

# Xem logs
docker-compose logs -f

# Dừng container
docker-compose down

# Restart container
docker-compose restart
```

### Cách 2: Build image và chạy container thủ công

**Bước 1:** Build Docker image

```bash
docker build -t openrouter-monitor:latest .
```

**Bước 2:** Chạy container

```bash
docker run -d \
  --name openrouter-monitor \
  --restart unless-stopped \
  -e OPENROUTER_API_KEY=sk-or-v1-xxxxx \
  -e TELEGRAM_BOT_TOKEN=123456789:ABCxxx \
  -e TELEGRAM_CHAT_ID=123456789 \
  -e BALANCE_THRESHOLD=4 \
  -e CHECK_INTERVAL_MINUTES=30 \
  openrouter-monitor:latest
```

Hoặc dùng file `.env`:

```bash
docker run -d \
  --name openrouter-monitor \
  --restart unless-stopped \
  --env-file .env \
  openrouter-monitor:latest
```

**Bước 3:** Quản lý container

```bash
# Xem logs
docker logs -f openrouter-monitor

# Dừng container
docker stop openrouter-monitor

# Start lại
docker start openrouter-monitor

# Restart
docker restart openrouter-monitor

# Xóa container
docker rm -f openrouter-monitor
```

### Cách 3: Push lên Docker Hub và pull trên VPS

**Trên máy local:**

```bash
# Build image
docker build -t your-dockerhub-username/openrouter-monitor:latest .

# Login Docker Hub
docker login

# Push image
docker push your-dockerhub-username/openrouter-monitor:latest
```

**Trên VPS:**

```bash
# Pull image
docker pull your-dockerhub-username/openrouter-monitor:latest

# Chạy container
docker run -d \
  --name openrouter-monitor \
  --restart unless-stopped \
  --env-file .env \
  your-dockerhub-username/openrouter-monitor:latest
```

### Auto-restart khi VPS khởi động lại

Docker container với flag `--restart unless-stopped` sẽ tự động start lại khi VPS reboot.

Với Docker Compose, container đã được cấu hình `restart: unless-stopped` sẵn.

### Kiểm tra container đang chạy

```bash
# Xem danh sách container
docker ps

# Xem logs real-time
docker logs -f openrouter-monitor

# Xem resource usage
docker stats openrouter-monitor
```

## Cách hoạt động

1. Khi khởi động, tool sẽ:
   - Kiểm tra kết nối Telegram bot
   - Chạy check balance lần đầu ngay lập tức
   - Đặt lịch check định kỳ theo `CHECK_INTERVAL_MINUTES`

2. Mỗi lần check:
   - Gọi OpenRouter API để lấy balance
   - Hiển thị thông tin: total credits, usage, remaining
   - Nếu remaining < threshold: gửi cảnh báo Telegram (có cooldown 1h)

3. Format thông báo Telegram:
   ```
   ⚠️ OpenRouter Credit Alert!

   🔴 Your OpenRouter balance is running low!

   💵 Current Balance: $X.XX
   ⚡️ Threshold: $4.00

   Please top-up your account to avoid service interruption.

   🕐 Time: [timestamp] UTC
   ```

## Project Structure

```
monitor-money/
├── src/
│   ├── index.ts              # Main entry point với scheduling logic
│   ├── config.ts             # Load và validate env variables
│   └── services/
│       ├── openrouter.ts     # OpenRouter API service
│       └── telegram.ts       # Telegram notification service
├── dist/                     # Compiled JavaScript (sau khi build)
├── .env                      # Configuration (không commit)
├── .env.example              # Template cho .env
├── Dockerfile                # Docker image definition
├── .dockerignore             # Files bỏ qua khi build Docker image
├── docker-compose.yml        # Docker Compose configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Chạy như service / daemon

### Dùng PM2 (khuyến nghị)

```bash
# Cài PM2 globally
npm install -g pm2

# Build project
npm run build

# Chạy với PM2
pm2 start dist/index.js --name openrouter-monitor

# Xem logs
pm2 logs openrouter-monitor

# Dừng
pm2 stop openrouter-monitor

# Restart
pm2 restart openrouter-monitor

# Tự động chạy khi khởi động hệ thống
pm2 startup
pm2 save
```

### Dùng screen/tmux (đơn giản)

```bash
# Screen
screen -S monitor
npm run monitor
# Nhấn Ctrl+A, D để detach

# Tmux
tmux new -s monitor
npm run monitor
# Nhấn Ctrl+B, D để detach
```

## Troubleshooting

### Error: Missing required environment variable

- Kiểm tra file `.env` có tồn tại không
- Đảm bảo tất cả các biến bắt buộc đã được điền

### Telegram API error

- Kiểm tra `TELEGRAM_BOT_TOKEN` đúng định dạng
- Đảm bảo bot đã được start (gửi `/start` cho bot)
- Kiểm tra `TELEGRAM_CHAT_ID` chính xác

### OpenRouter API error (401)

- Kiểm tra `OPENROUTER_API_KEY` còn valid
- Đảm bảo key có quyền truy cập API

## Notes / Ghi chú

- Balance data có thể delay tới 60 giây (theo OpenRouter docs)
- Alert cooldown mặc định: 1 giờ (tránh spam)
- Ngưỡng mặc định: $4 (điều chỉnh theo nhu cầu)
- Check interval mặc định: 30 phút (có thể giảm xuống 5-10 phút nếu cần)

## API References

- [OpenRouter Get Credits API](https://openrouter.ai/docs/api/api-reference/credits/get-credits)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## License

MIT
